export function groupAppointmentsByDate(appointments) {
  const map = new Map();
  for (const a of appointments) {
    if (!map.has(a.date)) map.set(a.date, []);
    map.get(a.date).push(a);
  }
  return map;
}

export async function processMileage({ homeAddress, appointments, geocoder, router, cache, onProgress }) {
  const grouped = groupAppointmentsByDate(appointments);
  const total = appointments.length;
  const homeGeo = await geocoder.geocode(homeAddress);

  let done = 0;
  const days = [];
  for (const [date, dayAppts] of grouped) {
    const day = { date, appointments: [], combinedRoute: null };
    const seen = new Set();
    for (const appt of dayAppts) {
      const ap = makeAppointment(appt.address);
      const norm = cache.normalizeAddress(appt.address);
      if (seen.has(norm)) {
        ap.status = 'Duplicate address';
        day.appointments.push(ap);
        done++;
        onProgress?.(done, total, ap.status);
        continue;
      }
      seen.add(norm);
      try {
        const cached = cache.getSegmentMiles(homeAddress, appt.address);
        const oneWay = cached ?? await (async () => {
          const geo = await geocoder.geocode(appt.address);
          const m = await router.getMiles(homeGeo, geo);
          cache.setSegmentMiles(homeAddress, appt.address, m);
          return m;
        })();
        ap.homeOneWayMiles = oneWay;
        ap.individualMiles = Number((oneWay * 2).toFixed(2));
        ap.finalIndividualMiles = ap.individualMiles;
        ap.status = cached != null ? 'Cached' : 'OK';
      } catch (e) {
        ap.status = e.message;
      }
      day.appointments.push(ap);
      done++;
      onProgress?.(done, total, ap.status);
      await new Promise(r => setTimeout(r, 20));
    }
    day.combinedRoute = await calculateCombinedTripMileage(day.appointments, homeAddress, homeGeo, geocoder, router, cache);
    days.push(day);
  }
  return days;
}

export function calculateIndividualTripMileage(appointment) {
  if (appointment.homeOneWayMiles == null) return null;
  return Number((appointment.homeOneWayMiles * 2).toFixed(2));
}

export async function calculateCombinedTripMileage(appointments, homeAddress, homeGeo, geocoder, router, cache) {
  const route = { chain: [homeAddress], segments: [], miles: null, finalMiles: null, edited: false, status: 'Pending' };
  const valid = appointments.filter(a => a.status === 'OK' || a.status === 'Cached');
  if (!valid.length) {
    route.status = 'No valid addresses';
    return route;
  }
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
  for (const a of valid) {
    try {
      const cached = cache.getSegmentMiles(prevAddress, a.address);
      const miles = cached ?? await (async () => {
        const geo = await geocoder.geocode(a.address);
        const m = await router.getMiles(prevGeo, geo);
        cache.setSegmentMiles(prevAddress, a.address, m);
        return m;
      })();
      route.segments.push({ from: prevAddress, to: a.address, miles, status: cached != null ? 'Cached' : 'OK' });
      route.chain.push(a.address);
      total += miles;
      prevGeo = await geocoder.geocode(a.address);
      prevAddress = a.address;
    } catch (e) {
      route.segments.push({ from: prevAddress, to: a.address, miles: null, status: e.message });
      anyError = true;
    }
  }
  try {
    const cached = cache.getSegmentMiles(prevAddress, homeAddress);
    const miles = cached ?? await (async () => {
      const m = await router.getMiles(prevGeo, homeGeo);
      cache.setSegmentMiles(prevAddress, homeAddress, m);
      return m;
    })();
    route.segments.push({ from: prevAddress, to: homeAddress, miles, status: cached != null ? 'Cached' : 'OK' });
    route.chain.push(homeAddress);
    total += miles;
  } catch (e) {
    route.segments.push({ from: prevAddress, to: homeAddress, miles: null, status: e.message });
    anyError = true;
  }
  route.miles = Number(total.toFixed(2));
  route.finalMiles = route.miles;
  route.status = anyError ? 'Partial errors in combined route' : 'OK';
  return route;
}

export function rebuildCombinedFromCache(appointments, homeAddress, cache) {
  const route = { chain: [homeAddress], segments: [], miles: null, finalMiles: null, edited: false, status: 'Pending' };
  const valid = appointments.filter(a => a.status === 'OK' || a.status === 'Cached');
  if (!valid.length) {
    route.status = 'No valid addresses';
    return route;
  }
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

function makeAppointment(address) {
  return {
    id: crypto.randomUUID(),
    address,
    status: 'Pending',
    homeOneWayMiles: null,
    individualMiles: null,
    finalIndividualMiles: null,
    individualEdited: false
  };
}
