// openrouteservice routing provider.
//
// Adds resilience that was previously missing:
//   - Request timeout via AbortController.
//   - Exponential backoff retry on 429/5xx/network errors.
//   - Clear error messages so the UI can surface meaningful statuses.
//
// The HTTP itself is unmetered by us — ORS enforces its own per-key quota.
// The provider is safe to call concurrently; each call is independent.

import { log } from './logger.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ENDPOINT_DIRECTIONS = 'https://api.openrouteservice.org/v2/directions/driving-car';
const ENDPOINT_MATRIX = 'https://api.openrouteservice.org/v2/matrix/driving-car';

export class OpenRouteServiceProvider {
  constructor(apiKey, { timeoutMs = 15000, retries = 3 } = {}) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
  }

  async validateKey() {
    // Small known-good request — Heidelberg coordinates from ORS docs.
    let res;
    try {
      res = await this._post(ENDPOINT_DIRECTIONS, { coordinates: [[8.681495, 49.41461], [8.687872, 49.420318]] }, 1);
    } catch (e) {
      if (e.message.includes('429') || e.message.includes('403')) {
        throw new Error('Invalid API key or Quota Exceeded.');
      }
      throw e;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) throw new Error('Invalid API key or Quota Exceeded.');
    if (!res.ok && res.status !== 400) throw new Error(`API key validation failed (${res.status})`);
    return res;
  }

  async getQuota() {
    if (!this.apiKey) return null;
    try {
      const res = await this.validateKey();
      const remaining = res.headers.get('x-ratelimit-remaining');
      const limit = res.headers.get('x-ratelimit-limit');
      const reset = res.headers.get('x-ratelimit-reset');
      if (remaining != null && limit != null) {
        return { remaining: Number(remaining), limit: Number(limit), reset: Number(reset) };
      }
    } catch (e) {
      // Ignore errors; just return null quota
    }
    return null;
  }

  async getMiles(from, to) {
    const body = { coordinates: [[from.lon, from.lat], [to.lon, to.lat]] };
    let res;
    try {
      res = await this._post(ENDPOINT_DIRECTIONS, body, this.retries);
    } catch (e) {
      if (e.message.includes('429') || e.message.includes('403')) {
        throw new Error('API Quota Exceeded');
      }
      throw e;
    }
    if (res.status === 429 || res.status === 403) throw new Error('API Quota Exceeded');
    if (!res.ok) throw new Error(`Routing error (${res.status})`);
    const data = await res.json();
    const meters = data?.routes?.[0]?.summary?.distance;
    if (meters == null) throw new Error('No route found');
    return meters * 0.000621371;
  }

  async getMatrix(locations) {
    // locations is an array of [lon, lat]
    const body = { locations, metrics: ['distance'], units: 'm' };
    let res;
    try {
      res = await this._post(ENDPOINT_MATRIX, body, this.retries);
    } catch (e) {
      if (e.message.includes('429') || e.message.includes('403')) {
        throw new Error('API Quota Exceeded');
      }
      throw e;
    }
    if (res.status === 429 || res.status === 403) throw new Error('API Quota Exceeded');
    if (!res.ok) throw new Error(`Matrix routing error (${res.status})`);
    const data = await res.json();
    if (!data || !data.distances) throw new Error('No matrix found');
    return data.distances;
  }

  // Centralized POST with timeout + retry. Returns the Response on terminal
  // outcomes (success OR non-retryable failure) so the caller can branch on
  // status code without re-implementing retry logic.
  async _post(endpoint, body, retries) {
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timer);
        // 4xx (other than 429) is terminal — auth/quota/input issues won't
        // succeed on retry. Hand the response back to the caller as-is.
        if (res.status !== 429 && res.status < 500) return res;
        if (res.ok) return res;
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
      }
      const backoff = 500 * Math.pow(2, attempt);
      log.warn(`route attempt ${attempt + 1} failed: ${lastErr.message} — retrying in ${backoff}ms`);
      if (attempt < retries - 1) await sleep(backoff);
    }
    throw lastErr || new Error('Routing failed');
  }
}
