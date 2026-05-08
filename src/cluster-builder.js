import { haversineMiles } from './haversine-utils.js';

export function buildClusters(stops, thresholdMiles = 10) {
  const n = stops.length;
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (haversineMiles(stops[i].geo, stops[j].geo) <= thresholdMiles) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const seen = new Array(n).fill(false);
  const groups = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const stack = [i];
    seen[i] = true;
    const component = [];
    while (stack.length) {
      const cur = stack.pop();
      component.push(stops[cur]);
      for (const nxt of adj[cur]) {
        if (!seen[nxt]) {
          seen[nxt] = true;
          stack.push(nxt);
        }
      }
    }
    groups.push(component);
  }
  return groups;
}
