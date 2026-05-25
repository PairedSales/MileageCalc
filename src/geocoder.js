// Nominatim forward geocoder.
//
// Optimizations vs. previous version:
//   1. "Next allowed time" throttle instead of a blind 1.1 s sleep before EVERY
//      request. If the caller already waited, we don't add extra delay.
//   2. Single-flight: concurrent geocode() calls for the same address share one
//      in-flight Promise so we don't fire duplicate HTTP requests.
//   3. Exponential backoff on transient errors (5xx / network / abort) but
//      not on 4xx "not found" — those would never succeed via retry.
//   4. Per-request timeout via AbortController so a hung connection cannot
//      stall the whole pipeline.
//   5. All addresses are normalized BEFORE the cache lookup and HTTP call so
//      we get higher hit rates and a clean query string.

import { normalizeAddress, validateAddress } from './validation.js';
import { log } from './logger.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class Geocoder {
  constructor(cache, { delayMs = 1100, timeoutMs = 12000, retries = 3 } = {}) {
    this.cache = cache;
    this.delayMs = delayMs;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this._nextAllowed = 0;          // epoch ms — earliest moment we may hit Nominatim
    this._inflight = new Map();     // normalized address -> Promise
  }

  // Reserve the next request slot. Returns the wait (ms) the caller must
  // observe. Reserving immediately advances the slot so concurrent callers
  // get sequential slots instead of all racing the same wakeup time.
  _reserveSlot() {
    const now = Date.now();
    const wait = Math.max(0, this._nextAllowed - now);
    this._nextAllowed = Math.max(now, this._nextAllowed) + this.delayMs;
    return wait;
  }

  async geocode(address) {
    const normalized = normalizeAddress(address);
    if (!normalized) throw new Error('Empty address');

    const validation = validateAddress(normalized);
    if (!validation.valid) throw new Error(`Invalid address (${validation.reason})`);

    const cached = this.cache.getGeocode(normalized);
    if (cached) return cached;

    // Single-flight: if another caller is already geocoding this address,
    // wait on the same Promise instead of issuing a duplicate request.
    const existing = this._inflight.get(normalized);
    if (existing) return existing;

    const promise = this._fetchWithFallback(address, normalized).finally(() => {
      this._inflight.delete(normalized);
    });
    this._inflight.set(normalized, promise);
    return promise;
  }

  async _fetchWithFallback(address, normalized) {
    try {
      return await this._fetch(address, normalized);
    } catch (e) {
      if (/not found/i.test(e.message)) {
        // Fallback: strip leading house numbers to geocode the street.
        const withoutNumber = address.replace(/^[\d-]+[a-zA-Z]*\s+/, '');
        if (withoutNumber !== address && withoutNumber.length > 5) {
          log.warn(`Geocode failed for "${address}", falling back to street level: "${withoutNumber}"`);
          const point = await this._fetch(withoutNumber, normalized);
          // Result is already cached by _fetch, but we can ensure it here.
          this.cache.setGeocode(normalized, point);
          return point;
        }
      }
      throw e;
    }
  }

  async _fetch(query, cacheKey) {
    let lastErr;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const wait = this._reserveSlot();
      if (wait > 0) await sleep(wait);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&email=mileagecalc@example.com&q=${encodeURIComponent(query)}`;
      try {
        const res = await fetch(url, {
          headers: { 'Accept-Language': 'en', 'User-Agent': 'MileageCalc/1.0' },
          signal: controller.signal
        });
        clearTimeout(timer);
        if (res.status === 404 || res.status === 400) throw new Error('Address not found');
        if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
        const data = await res.json();
        if (!data.length) throw new Error('Address not found');
        const point = {
          lat: Number(data[0].lat),
          lon: Number(data[0].lon),
          displayName: data[0].display_name
        };
        this.cache.setGeocode(cacheKey, point);
        log.debug('geocoded', query, '->', point.lat, point.lon);
        return point;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        // Don't retry "not found" — it won't change on the next call.
        if (/not found/i.test(e.message)) break;
        const backoff = 500 * Math.pow(2, attempt);
        log.warn(`geocode attempt ${attempt + 1} failed for "${query}": ${e.message} — retrying in ${backoff}ms`);
        if (attempt < this.retries - 1) await sleep(backoff);
      }
    }
    throw lastErr || new Error('Geocode failed');
  }
}
