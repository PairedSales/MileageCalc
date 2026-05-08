import { normalizeDate } from './date-normalizer.js';

export async function parseSpreadsheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: true });
  return rows.slice(1)
    .map((r, idx) => {
      const address = (r[0] || '').toString().trim();
      if (!address) return null;
      const date = normalizeDate(r[1]);
      return { inputIndex: idx, address, date };
    })
    .filter(Boolean);
}
