export function parseRateLimitHeaders(headers) {
  const limitRaw = headers?.get?.('X-RateLimit-Limit');
  const remainingRaw = headers?.get?.('X-RateLimit-Remaining');
  const resetRaw = headers?.get?.('X-RateLimit-Reset');

  const limit = Number.parseInt(limitRaw ?? '', 10);
  const remaining = Number.parseInt(remainingRaw ?? '', 10);
  const resetEpoch = Number.parseInt(resetRaw ?? '', 10);

  const hasNumeric = Number.isFinite(limit) && Number.isFinite(remaining);
  return {
    quotaAvailable: hasNumeric,
    totalQuota: hasNumeric ? Math.max(0, limit) : null,
    remainingQuota: hasNumeric ? Math.max(0, remaining) : null,
    resetTime: Number.isFinite(resetEpoch) ? new Date(resetEpoch * 1000) : null
  };
}
