export function estimateRequests({ destinations, homeAddress, cache }) {
  if (!Array.isArray(destinations) || !homeAddress) return 0;

  let requests = 0;
  for (const destination of destinations) {
    const address = typeof destination === 'string' ? destination : destination?.address;
    if (!address) continue;
    if (!cache.getDistance(homeAddress, address)) requests += 1;
  }

  return requests;
}
