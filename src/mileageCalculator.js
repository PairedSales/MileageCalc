import { QuotaExhaustedError } from './routingProvider.js';

export async function processMileage({ homeAddress, destinations, geocoder, router, cache, onProgress, groupDuplicates = true }) {
import { buildDailyGroups } from './grouping-engine.js';

async function getLegMiles(fromAddress, fromGeo, toAddress, toGeo, router, cache) {
  const cached = cache.getLegDistance(fromAddress, toAddress);
  if (cached !== null) return { miles: cached, cached: true };
  const miles = await router.getMiles(fromGeo, toGeo);
  cache.setLegDistance(fromAddress, toAddress, miles);
  return { miles, cached: false };
}

export async function processMileage({ homeAddress, destinations, geocoder, router, cache, onProgress, groupNearbySameDay = true }) {
  const rows = [];
  const homeGeo = await geocoder.geocode(homeAddress);
  const processed = [];

  for (let i = 0; i < destinations.length; i++) {
    const address = destinations[i];
    const norm = cache.normalizeAddress(address);
    const row = { id: crypto.randomUUID(), address, status: 'Pending', calculatedMiles: null, finalMiles: null, edited: false };
    if (groupDuplicates && seen.has(norm)) {
      row.status = 'Duplicate address';
      rows.push(row);
      onProgress?.(i + 1, destinations.length, row.status);
      continue;
    }
    seen.add(norm);
    const dest = destinations[i];
    const row = { id: crypto.randomUUID(), address: dest.address, date: dest.date, status: 'Pending', calculatedMiles: null, finalMiles: null, baselineMiles: null, edited: false, groupId: null, sequence: 1, grouped: false };
    try {
      row.geo = await geocoder.geocode(dest.address);
      row.status = 'Ready';
    } catch (e) {
      row.status = e.message;
      rows.push(row);
      onProgress?.(i + 1, destinations.length, row.status);
      if (e instanceof QuotaExhaustedError) break;
      continue;
    }
    processed.push(row);
    onProgress?.(i + 1, destinations.length, row.status);
  }

  const ready = processed.filter(r => r.status === 'Ready');
  const byDate = ready.reduce((acc, r) => { (acc[r.date] ||= []).push(r); return acc; }, {});
  const routable = groupNearbySameDay ? buildDailyGroups(byDate, homeGeo) : ready.map(r => ({ ...r, groupId: null, sequence: 1, grouped: false, groupSize: 1 }));

  const groupBuckets = routable.reduce((acc, r) => {
    const key = `${r.date}|${r.groupId || r.id}`;
    (acc[key] ||= []).push(r);
    return acc;
  }, {});

  for (const stops of Object.values(groupBuckets)) {
    stops.sort((a, b) => a.sequence - b.sequence);
    try {
      let total = 0;
      if (stops.length === 1 && !stops[0].grouped) {
        const leg = await getLegMiles(homeAddress, homeGeo, stops[0].address, stops[0].geo, router, cache);
        total = leg.miles * 2;
      } else {
        const first = stops[0];
        total += (await getLegMiles(homeAddress, homeGeo, first.address, first.geo, router, cache)).miles;
        for (let i = 0; i < stops.length - 1; i++) {
          total += (await getLegMiles(stops[i].address, stops[i].geo, stops[i + 1].address, stops[i + 1].geo, router, cache)).miles;
        }
        const last = stops[stops.length - 1];
        total += (await getLegMiles(last.address, last.geo, homeAddress, homeGeo, router, cache)).miles;
      }

      for (const s of stops) {
        const base = (await getLegMiles(homeAddress, homeGeo, s.address, s.geo, router, cache)).miles * 2;
        s.baselineMiles = Number(base.toFixed(2));
      }
      const perStop = total / stops.length;
      stops.forEach(s => {
        s.calculatedMiles = Number(perStop.toFixed(2));
        s.finalMiles = s.edited ? s.finalMiles : s.calculatedMiles;
        s.status = 'OK';
      });
    } catch (e) {
      for (const s of stops) {
        try {
          const miles = (await getLegMiles(homeAddress, homeGeo, s.address, s.geo, router, cache)).miles * 2;
          s.calculatedMiles = Number(miles.toFixed(2));
          s.finalMiles = s.edited ? s.finalMiles : s.calculatedMiles;
          s.status = `Fallback: ${e.message}`;
        } catch (inner) {
          s.status = inner.message;
        }
      }
    }
  }

  processed.forEach(r => {
    const enriched = routable.find(x => x.id === r.id);
    rows.push({ ...r, ...enriched, geo: undefined });
  });

  return rows;
}
