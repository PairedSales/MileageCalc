const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class Geocoder {
  constructor(cache, delayMs = 1100) { this.cache = cache; this.delayMs = delayMs; }
  async geocode(address, retries = 3) {
    const cached = this.cache.getGeocode(address); if (cached) return cached;
    for (let i = 0; i < retries; i++) {
      try {
        await sleep(this.delayMs);
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, {
          headers: { 'Accept-Language': 'en', 'User-Agent': 'MileageCalc/1.0' }, signal: controller.signal
        });
        clearTimeout(t);
        if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
        const data = await res.json();
        if (!data.length) throw new Error('Address not found');
        const point = { lat: Number(data[0].lat), lon: Number(data[0].lon), displayName: data[0].display_name };
        this.cache.setGeocode(address, point); return point;
      } catch (e) { if (i === retries - 1) throw e; await sleep(500 * (i + 1)); }
    }
  }
}
