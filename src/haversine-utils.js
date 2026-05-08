const R_MI = 3958.7613;
const toRad = (deg) => (deg * Math.PI) / 180;

export function haversineMiles(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.sqrt(h));
}
