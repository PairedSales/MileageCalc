export function exportCsv(days) {
  const head = ['Date', 'Addresses', 'Individual Miles', 'Combined Miles', 'Status'];
  const body = days.map(d => {
    const addresses = d.appointments.map(a => a.address).join('; ');
    const indiv = d.appointments.reduce((s, a) => s + (Number(a.finalIndividualMiles) || 0), 0);
    const combined = Number(d.combinedRoute?.finalMiles) || 0;
    const apptStatuses = d.appointments.map(a => a.status).filter(s => !['OK', 'Cached'].includes(s));
    const status = apptStatuses.length ? apptStatuses.join('; ') : (d.combinedRoute?.status || 'OK');
    return [d.date, addresses, indiv.toFixed(2), combined.toFixed(2), status];
  });

  const grandIndiv = days.reduce((s, d) => s + d.appointments.reduce((ss, a) => ss + (Number(a.finalIndividualMiles) || 0), 0), 0);
  const grandCombined = days.reduce((s, d) => s + (Number(d.combinedRoute?.finalMiles) || 0), 0);
  body.push(['TOTAL', '', grandIndiv.toFixed(2), grandCombined.toFixed(2), '']);

  const csv = [head, ...body]
    .map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mileage-results-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
