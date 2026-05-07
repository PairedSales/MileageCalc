import { QuotaExhaustedError } from './routingProvider.js';

export async function processMileage({ homeAddress, destinations, geocoder, router, cache, onProgress, groupDuplicates = true }) {
  const rows = [];
  const seen = new Set();
  const homeGeo = await geocoder.geocode(homeAddress);

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
    try {
      const cached = cache.getDistance(homeAddress, address);
      const miles = cached ?? (await (async () => {
        const geo = await geocoder.geocode(address);
        const oneWay = await router.getMiles(homeGeo, geo);
        const roundTrip = oneWay * 2;
        cache.setDistance(homeAddress, address, roundTrip);
        return roundTrip;
      })());
      row.calculatedMiles = Number(miles.toFixed(2));
      row.finalMiles = row.calculatedMiles;
      row.status = cached ? 'Cached' : 'OK';
    } catch (e) {
      row.status = e.message;
      rows.push(row);
      onProgress?.(i + 1, destinations.length, row.status);
      if (e instanceof QuotaExhaustedError) break;
      continue;
    }
    rows.push(row);
    onProgress?.(i + 1, destinations.length, row.status);
    await new Promise(r => setTimeout(r, 20));
  }
  return rows;
}
