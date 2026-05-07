import { haversineMiles } from './haversine-utils.js';

export function nearestNeighborOrder(homeGeo, stops) {
  const remaining = [...stops];
  const ordered = [];
  let current = { geo: homeGeo };
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineMiles(current.geo, remaining[i].geo);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    current = next;
  }
  return ordered;
}
