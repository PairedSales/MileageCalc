export async function parseSpreadsheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  return rows
    .slice(1)
    .map(r => (r[0] || '').toString().trim())
    .filter(v => v.length);
}
