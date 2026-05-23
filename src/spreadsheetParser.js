export async function parseSpreadsheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false, dateNF: 'yyyy-mm-dd' });
  if (!rows.length) return [];

  const header = rows[0].map(h => String(h ?? '').trim().toLowerCase());
  const dateIdx = header.indexOf('date');
  const addressIdx = header.indexOf('address');
  if (dateIdx === -1 || addressIdx === -1) {
    throw new Error('Spreadsheet must include "Date" and "Address" columns.');
  }

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const date = normalizeDate(r[dateIdx]);
    const address = String(r[addressIdx] ?? '').trim();
    if (!date || !address) continue;
    out.push({ date, address });
  }
  return out;
}

function normalizeDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !isNaN(value)) return toIsoDate(value);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    let [, mo, da, yr] = slash;
    if (yr.length === 2) yr = (Number(yr) >= 70 ? '19' : '20') + yr;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return toIsoDate(d);
  return s;
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
