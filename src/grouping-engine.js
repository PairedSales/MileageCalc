import { buildClusters } from './cluster-builder.js';
import { nearestNeighborOrder } from './route-optimizer.js';

export function buildDailyGroups(stopsByDate, homeGeo) {
  const grouped = [];
  let gid = 1;

  for (const [date, stops] of Object.entries(stopsByDate)) {
    const clusters = buildClusters(stops, 10);
    for (const cluster of clusters) {
      const ordered = cluster.length > 1 ? nearestNeighborOrder(homeGeo, cluster) : cluster;
      const groupId = cluster.length > 1 ? `G${gid++}` : null;
      ordered.forEach((stop, idx) => {
        grouped.push({ ...stop, date, groupId, sequence: idx + 1, grouped: Boolean(groupId), groupSize: ordered.length });
      });
    }
  }

  return grouped;
}
