export function normalizeDate(value) {
  if (value === null || value === undefined || value === '') throw new Error('Date is required');

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return toIsoDate(date);
  }

  const raw = String(value).trim();
  if (!raw) throw new Error('Date is required');

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const normalized = raw.replace(/\./g, '/').replace(/-/g, '/');
  const parts = normalized.split('/').map(p => p.trim());

  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    if ([a, b, c].every(Number.isFinite)) {
      if (String(parts[0]).length === 4) return toIsoDate(new Date(a, b - 1, c));
      if (c > 31) return toIsoDate(new Date(c, a - 1, b));
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${raw}`);
  return toIsoDate(parsed);
}

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('Invalid date value');
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
