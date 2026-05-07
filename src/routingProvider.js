export class QuotaExhaustedError extends Error {
  constructor(message = 'API quota exhausted. Processing stopped before completion.') {
    super(message);
    this.name = 'QuotaExhaustedError';
  }
}

export class OpenRouteServiceProvider {
  constructor(apiKey, { onResponse } = {}) {
    this.apiKey = apiKey;
    this.onResponse = onResponse;
  }

  async request(coordinates) {
    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates })
    });
    this.onResponse?.(res);
    return res;
  }

  async validateKey() {
    const res = await this.request([[8.681495, 49.41461], [8.687872, 49.420318]]);
    if (res.status === 401 || res.status === 403) throw new Error('Invalid API key.');
    if (res.status === 429) throw new QuotaExhaustedError();
    if (!res.ok && res.status !== 400) throw new Error(`API key validation failed (${res.status})`);
  }

  async getMiles(from, to) {
    const res = await this.request([[from.lon, from.lat], [to.lon, to.lat]]);
    if (res.status === 429) throw new QuotaExhaustedError();
    if (!res.ok) throw new Error(`Routing error (${res.status})`);
    const data = await res.json();
    const meters = data?.routes?.[0]?.summary?.distance;
    if (!meters) throw new Error('No route found');
    return meters * 0.000621371;
  }
}
