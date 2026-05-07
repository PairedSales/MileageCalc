const GEO_KEY = 'mileagecalc:geo:v1';
const DIST_KEY = 'mileagecalc:dist:v1';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

export class CacheManager {
  normalizeAddress(address) { return address.trim().toLowerCase().replace(/\s+/g, ' '); }
  getGeocode(address) { return read(GEO_KEY)[this.normalizeAddress(address)] || null; }
  setGeocode(address, value) { const m = read(GEO_KEY); m[this.normalizeAddress(address)] = value; write(GEO_KEY, m); }
  getDistance(home, destination) { return read(DIST_KEY)[`${this.normalizeAddress(home)}|${this.normalizeAddress(destination)}`] ?? null; }
  setDistance(home, destination, miles) { const m = read(DIST_KEY); m[`${this.normalizeAddress(home)}|${this.normalizeAddress(destination)}`] = miles; write(DIST_KEY, m); }
}
