// Persistent localStorage cache for geocode results and route segment miles.
//
// Cache keys are derived from `cacheKey(...)` (defined in validation.js) so
// surface-level differences ("1 e wacker dr." vs "1 East Wacker Drive") collapse
// to the same entry. The cache layer itself is dumb on purpose — normalization
// lives next to validation where the rules are defined.

import { cacheKey } from './validation.js';

const GEO_KEY  = 'mileagecalc:geo:v1';
const SEG_KEY  = 'mileagecalc:seg:v1';
// Retained for back-compat with anything that may still call get/setDistance.
const DIST_KEY = 'mileagecalc:dist:v1';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota: best-effort */ } };

export class CacheManager {
  // Kept for callers that import it directly. Delegates to the canonical
  // cacheKey() so normalization rules can never drift between modules.
  normalizeAddress(address) { return cacheKey(address); }

  getGeocode(address)         { return read(GEO_KEY)[cacheKey(address)] || null; }
  setGeocode(address, value)  { const m = read(GEO_KEY);  m[cacheKey(address)] = value; write(GEO_KEY, m); }

  getDistance(home, dest)        { return read(DIST_KEY)[`${cacheKey(home)}|${cacheKey(dest)}`] ?? null; }
  setDistance(home, dest, miles) { const m = read(DIST_KEY); m[`${cacheKey(home)}|${cacheKey(dest)}`] = miles; write(DIST_KEY, m); }

  getSegmentMiles(from, to)        { return read(SEG_KEY)[`${cacheKey(from)}|${cacheKey(to)}`] ?? null; }
  setSegmentMiles(from, to, miles) { const m = read(SEG_KEY); m[`${cacheKey(from)}|${cacheKey(to)}`] = miles; write(SEG_KEY, m); }
}
