export function estimateRequests({ destinations, homeAddress, cache, groupDuplicates }) {
  if (!Array.isArray(destinations) || !homeAddress) return 0;
  const seen = new Set();
  let requests = 0;
  for (const address of destinations) {
    const norm = cache.normalizeAddress(address);
    if (groupDuplicates && seen.has(norm)) continue;
    seen.add(norm);
    if (!cache.getDistance(homeAddress, address)) requests += 1;
  }
  return requests;
}
