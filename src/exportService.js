export function exportCsv(rows) {
  const head = ['Address', 'Final Mileage', 'Edited', 'Status'];
  const body = rows.map(r => [r.address, (r.finalMiles ?? '').toString(), r.edited ? 'Edited' : 'Calculated', r.status]);
  const csv = [head, ...body].map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mileage-results-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(a.href);
}
