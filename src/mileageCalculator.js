// Mileage calculation pipeline.
//
// Architectural overview:
//   - Appointments are grouped by date. Each date is one "day" with its own
//     combined-route calculation.
//   - For each appointment we compute the round-trip "individual" mileage
//     (home -> dest -> home) and emit a streaming event as soon as it's known.
//   - For each day we then compute the "combined" multi-stop route once all
//     of its appointments have been resolved.
//
// Key optimizations vs. previous version:
//   1. STREAMING: every state change emits an `onEvent({type, ...})` callback
//      so the UI can paint progress in real time instead of waiting for the
//      whole batch to finish.
//   2. NO ARTIFICIAL BLOCKING: removed the 20 ms per-appointment sleep. The
//      geocoder enforces its own rate limit internally; we don't need a
//      second one here.
//   3. CACHE-FIRST: anything already in the segment cache resolves instantly
//      without any network call.
//   4. KEEP DUPLICATES: same address on the same day is still counted
//      separately (each appointment is a real visit). Cache hits make repeat
//      addresses essentially free after the first lookup.
//   5. PER-APPOINTMENT ISOLATION: a single bad address can't kill the run —
//      its error is captured and processing continues.

import { log } from './logger.js';
import { validateAddress } from './validation.js';

async function checkPause(pauseState, signal) {
  while (pauseState?.paused && !signal?.aborted) {
    await new Promise(r => setTimeout(r, 200));
  }
}

export function groupAppointmentsByDate(appointments) {
  const map = new Map();
  for (const a of appointments) {
    if (!map.has(a.date)) map.set(a.date, []);
    map.get(a.date).push(a);
  }
  return map;
}

export async function processMileage({
  homeAddress, appointments, geocoder, router, cache, signal, pauseState,
  onEvent = () => {}, onProgress
}) {
  const grouped = groupAppointmentsByDate(appointments);
  const total = appointments.length;
  let done = 0;

  const emitProgress = (status) => {
    done++;
    onProgress?.(done, total, status);
  };

  // Geocode home once up front. If this fails the run can't continue.
  let homeGeo;
  try {
    homeGeo = await geocoder.geocode(homeAddress);
    log.info('home geocoded:', homeAddress);
  } catch (e) {
    log.error('home geocode failed:', e.message);
    throw new Error(`Home address geocode failed: ${e.message}`);
  }

  const days = [];
  for (const [date, dayAppts] of grouped) {
    const day = { date, appointments: [], combinedRoute: null };
    days.push(day);
    onEvent({ type: 'day-start', date, count: dayAppts.length });

    for (const appt of dayAppts) {
      await checkPause(pauseState, signal);
      if (signal?.aborted) throw new Error('Aborted by user');

      const ap = makeAppointment(appt.address, appt.rawAddress);
      day.appointments.push(ap);

      // Pre-flight validation. Cheap, catches obvious garbage before any
      // network round-trip.
      const v = validateAddress(appt.address);
      if (!v.valid) {
        ap.status = `Invalid: ${v.reason}`;
        log.warn(`skipping ${appt.address}: ${v.reason}`);
        onEvent({ type: 'appointment', date, origin: homeAddress, destination: appt.address, miles: null, status: ap.status });
        emitProgress(ap.status);
        continue;
      }

      try {
        const cached = cache.getSegmentMiles(homeAddress, appt.address);
        let oneWay, fromCache = false;
        if (cached != null) {
          oneWay = cached;
          fromCache = true;
        } else {
          const destGeo = await geocoder.geocode(appt.address);
          oneWay = await router.getMiles(homeGeo, destGeo);
          cache.setSegmentMiles(homeAddress, appt.address, oneWay);
          cache.setSegmentMiles(appt.address, homeAddress, oneWay);
        }
        ap.homeOneWayMiles = oneWay;
        ap.individualMiles = Number((oneWay * 2).toFixed(2));
        ap.finalIndividualMiles = ap.individualMiles;
        ap.status = fromCache ? 'Cached' : 'OK';
        log.info(`${date} | Home -> ${appt.address} | ${ap.individualMiles} mi (${ap.status})`);
        onEvent({
          type: 'appointment', date,
          origin: homeAddress, destination: appt.address,
          miles: ap.individualMiles, status: ap.status
        });
      } catch (e) {
        ap.status = e.message || 'Unknown error';
        log.error(`failed ${date} ${appt.address}:`, ap.status);
        onEvent({
          type: 'appointment', date,
          origin: homeAddress, destination: appt.address,
          miles: null, status: ap.status, error: true
        });
      }
      emitProgress(ap.status);
    }

    // Combined route only after all per-appointment work is in.
    try {
      await checkPause(pauseState, signal);
      if (signal?.aborted) throw new Error('Aborted by user');
      day.combinedRoute = await calculateCombinedTripMileage(
        day.appointments, homeAddress, homeGeo, geocoder, router, cache, onEvent, date, signal, pauseState
      );
      onEvent({
        type: 'combined', date,
        chain: day.combinedRoute.chain,
        miles: day.combinedRoute.finalMiles,
        status: day.combinedRoute.status
      });
    } catch (e) {
      log.error('combined route failed for', date, e.message);
      day.combinedRoute = { chain: [], segments: [], miles: null, finalMiles: null, edited: false, status: e.message };
      onEvent({ type: 'combined', date, chain: [], miles: null, status: e.message, error: true });
    }

    onEvent({ type: 'day-end', date });
  }
  return days;
}

export function calculateIndividualTripMileage(appointment) {
  if (appointment.homeOneWayMiles == null) return null;
  return Number((appointment.homeOneWayMiles * 2).toFixed(2));
}

// Computes Home -> A -> B -> ... -> Home. Each leg is resolved independently:
// a failed leg is recorded but the rest of the chain continues so the user
// still gets partial results.
export async function calculateCombinedTripMileage(appointments, homeAddress, homeGeo, geocoder, router, cache, onEvent = () => {}, date = null, signal = null, pauseState = null) {
  const route = { chain: [homeAddress], segments: [], miles: null, finalMiles: null, edited: false, status: 'Pending' };
  const valid = appointments.filter(a => a.status === 'OK' || a.status === 'Cached');
  if (!valid.length) { route.status = 'No valid addresses'; return route; }

  if (valid.length === 1) {
    const a = valid[0];
    route.chain = [homeAddress, a.address, homeAddress];
    route.segments = [
      { from: homeAddress, to: a.address, miles: a.homeOneWayMiles, status: 'OK' },
      { from: a.address, to: homeAddress, miles: a.homeOneWayMiles, status: 'OK' }
    ];
    route.miles = a.individualMiles;
    route.finalMiles = a.individualMiles;
    route.status = 'OK';
    return route;
  }

  let prevAddress = homeAddress;
  let prevGeo = homeGeo;
  let total = 0;
  let anyError = false;

  const stops = [...valid.map(v => v.address), homeAddress];

  for (const nextAddress of stops) {
    await checkPause(pauseState, signal);
    if (signal?.aborted) throw new Error('Aborted by user');

    try {
      const cached = cache.getSegmentMiles(prevAddress, nextAddress);
      let miles, fromCache = false;
      if (cached != null) {
        miles = cached;
        fromCache = true;
      } else {
        // Reuse already-cached destination geocode when possible.
        const nextGeo = nextAddress === homeAddress ? homeGeo : await geocoder.geocode(nextAddress);
        miles = await router.getMiles(prevGeo, nextGeo);
        cache.setSegmentMiles(prevAddress, nextAddress, miles);
        prevGeo = nextGeo;
      }
      route.segments.push({ from: prevAddress, to: nextAddress, miles, status: fromCache ? 'Cached' : 'OK' });
      route.chain.push(nextAddress);
      total += miles;
      onEvent({ type: 'segment', date, origin: prevAddress, destination: nextAddress, miles: Number(miles.toFixed(2)), status: fromCache ? 'Cached' : 'OK' });
      prevAddress = nextAddress;
      if (cached != null && nextAddress !== homeAddress) {
        // We didn't refresh prevGeo above (took the cache branch). Fetch it
        // lazily only if there's a next segment that will need it.
        prevGeo = await geocoder.geocode(nextAddress);
      }
    } catch (e) {
      anyError = true;
      route.segments.push({ from: prevAddress, to: nextAddress, miles: null, status: e.message });
      onEvent({ type: 'segment', date, origin: prevAddress, destination: nextAddress, miles: null, status: e.message, error: true });
      // Keep walking; treat this stop as the new "prev" anyway so subsequent
      // legs are still attempted from the intended geography.
      prevAddress = nextAddress;
    }
  }

  route.miles = Number(total.toFixed(2));
  route.finalMiles = route.miles;
  route.status = anyError ? 'Partial errors in combined route' : 'OK';
  return route;
}

// Pure cache-only rebuild used after edits/removals so we don't re-hit the API
// just to update totals when a row is deleted.
export function rebuildCombinedFromCache(appointments, homeAddress, cache) {
  const route = { chain: [homeAddress], segments: [], miles: null, finalMiles: null, edited: false, status: 'Pending' };
  const valid = appointments.filter(a => a.status === 'OK' || a.status === 'Cached');
  if (!valid.length) { route.status = 'No valid addresses'; return route; }

  if (valid.length === 1) {
    const a = valid[0];
    route.chain = [homeAddress, a.address, homeAddress];
    route.segments = [
      { from: homeAddress, to: a.address, miles: a.homeOneWayMiles, status: 'OK' },
      { from: a.address, to: homeAddress, miles: a.homeOneWayMiles, status: 'OK' }
    ];
    route.miles = a.individualMiles;
    route.finalMiles = a.individualMiles;
    route.status = 'OK';
    return route;
  }

  let prev = homeAddress;
  let total = 0;
  for (const a of valid) {
    const cached = cache.getSegmentMiles(prev, a.address);
    if (cached == null) { route.status = 'Stale — reprocess to update'; return route; }
    route.segments.push({ from: prev, to: a.address, miles: cached, status: 'Cached' });
    route.chain.push(a.address);
    total += cached;
    prev = a.address;
  }
  const back = cache.getSegmentMiles(prev, homeAddress);
  if (back == null) { route.status = 'Stale — reprocess to update'; return route; }
  route.segments.push({ from: prev, to: homeAddress, miles: back, status: 'Cached' });
  route.chain.push(homeAddress);
  total += back;
  route.miles = Number(total.toFixed(2));
  route.finalMiles = route.miles;
  route.status = 'OK';
  return route;
}

function makeAppointment(address, rawAddress) {
  return {
    id: crypto.randomUUID(),
    address,
    rawAddress: rawAddress || address,
    status: 'Pending',
    homeOneWayMiles: null,
    individualMiles: null,
    finalIndividualMiles: null,
    individualEdited: false
  };
}
