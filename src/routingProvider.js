export class OpenRouteServiceProvider {
  constructor(apiKey) { this.apiKey = apiKey; }
  async validateKey() {
    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST', headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[8.681495,49.41461],[8.687872,49.420318]] })
    });
    if (res.status === 401 || res.status === 403) throw new Error('Invalid API key.');
    if (!res.ok && res.status !== 400) throw new Error(`API key validation failed (${res.status})`);
  }
  async getMiles(from, to) {
    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST', headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[from.lon, from.lat], [to.lon, to.lat]] })
    });
    if (!res.ok) throw new Error(`Routing error (${res.status})`);
    const data = await res.json();
    const meters = data?.routes?.[0]?.summary?.distance;
    if (!meters) throw new Error('No route found');
    return meters * 0.000621371;
  }
}
