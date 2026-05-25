export function exportCsv(days) {
  let totalValidMiles = 0;
  let totalValidTrips = 0;
  days.forEach(d => {
    d.appointments.forEach(a => {
      const miles = Number(a.finalIndividualMiles);
      if (miles > 0 && ['OK', 'Cached', 'Retry OK'].includes(a.status)) {
        totalValidMiles += miles;
        totalValidTrips++;
      }
    });
  });
  const avgIndividualMiles = totalValidTrips > 0 ? (totalValidMiles / totalValidTrips) : 0;

  const head = ['Date', 'Addresses', 'Individual Miles', 'Combined Miles', 'Status'];
  let grandIndiv = 0;
  let grandCombined = 0;

  const body = days.map(d => {
    const addresses = d.appointments.map(a => a.address).join('; ');
    let indiv = 0;
    let anyEstimated = false;

    const apptStatuses = d.appointments.map(a => {
      let m = Number(a.finalIndividualMiles);
      let stat = a.status;
      if (!m || !['OK', 'Cached', 'Retry OK'].includes(stat)) {
        m = avgIndividualMiles;
        anyEstimated = true;
        stat = 'Estimated (Not Found)';
      }
      indiv += m;
      return stat;
    }).filter(s => !['OK', 'Cached', 'Retry OK'].includes(s));

    const combined = Number(d.combinedRoute?.finalMiles) || 0;
    grandIndiv += indiv;
    grandCombined += combined;

    const status = apptStatuses.length ? apptStatuses.join('; ') : (d.combinedRoute?.status || 'OK');
    return [d.date, addresses, indiv.toFixed(2) + (anyEstimated ? '*' : ''), combined.toFixed(2), status];
  });

  body.push(['TOTAL', '', grandIndiv.toFixed(2), grandCombined.toFixed(2), '']);
  body.push([]);
  body.push([`* Indicates estimated miles based on average of all individual trips (${avgIndividualMiles.toFixed(2)} miles)`]);

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

export function exportPdf(days) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  let totalValidMiles = 0;
  let totalValidTrips = 0;
  days.forEach(d => {
    d.appointments.forEach(a => {
      const miles = Number(a.finalIndividualMiles);
      if (miles > 0 && ['OK', 'Cached', 'Retry OK'].includes(a.status)) {
        totalValidMiles += miles;
        totalValidTrips++;
      }
    });
  });
  const avgIndividualMiles = totalValidTrips > 0 ? (totalValidMiles / totalValidTrips) : 0;

  const processedDays = [];
  const yearlyTotals = {};
  let grandIndiv = 0;
  let grandCombined = 0;

  days.forEach(d => {
    let indiv = 0;
    let anyEstimated = false;

    const apptStatuses = d.appointments.map(a => {
      let m = Number(a.finalIndividualMiles);
      let stat = a.status;
      if (!m || !['OK', 'Cached', 'Retry OK'].includes(stat)) {
        m = avgIndividualMiles;
        anyEstimated = true;
        stat = 'Estimated';
      }
      indiv += m;
      return stat;
    }).filter(s => !['OK', 'Cached', 'Retry OK'].includes(s));

    const combined = Number(d.combinedRoute?.finalMiles) || 0;

    // Do not show days with no miles
    if (indiv === 0 && combined === 0) {
      return;
    }

    const year = new Date(d.date).getFullYear() || 'Unknown Year';
    if (!yearlyTotals[year]) yearlyTotals[year] = { indiv: 0, combined: 0 };
    yearlyTotals[year].indiv += indiv;
    yearlyTotals[year].combined += combined;

    grandIndiv += indiv;
    grandCombined += combined;

    const addresses = d.appointments.map(a => a.address).join('; ');
    const status = apptStatuses.length ? apptStatuses.join('; ') : (d.combinedRoute?.status || 'OK');
    
    processedDays.push([d.date, addresses, indiv.toFixed(2) + (anyEstimated ? '*' : ''), combined.toFixed(2), status]);
  });

  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text('Mileage Report', 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 30);
  
  let currentY = 40;
  const years = Object.keys(yearlyTotals).sort((a, b) => b - a); // Sort newest first
  if (years.length > 0) {
    doc.setFontSize(12);
    doc.setTextColor(40, 40, 40);
    doc.text('Yearly Breakdown:', 14, currentY);
    currentY += 8;
    
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    years.forEach(year => {
      const { indiv, combined } = yearlyTotals[year];
      doc.text(`${year} - Individual Miles: ${indiv.toFixed(2)} | Combined Miles: ${combined.toFixed(2)}`, 14, currentY);
      currentY += 6;
    });
    currentY += 4; // Add extra space before table
  } else {
    currentY = 40;
  }

  const head = [['Date', 'Addresses', 'Individual Miles', 'Combined Miles', 'Status']];
  const body = processedDays;
  
  body.push([{ content: 'TOTAL', styles: { fontStyle: 'bold' } }, '', { content: grandIndiv.toFixed(2), styles: { fontStyle: 'bold' } }, { content: grandCombined.toFixed(2), styles: { fontStyle: 'bold' } }, '']);

  doc.autoTable({
    head: head,
    body: body,
    startY: currentY,
    theme: 'striped',
    headStyles: { fillColor: [66, 139, 202] },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      1: { cellWidth: 'auto' }, // Addresses
      2: { halign: 'right' },
      3: { halign: 'right' }
    }
  });

  let finalY = doc.lastAutoTable.finalY || currentY;
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`* Indicates estimated miles based on the average of all valid individual trips (${avgIndividualMiles.toFixed(2)} miles).`, 14, finalY + 10);

  doc.save(`mileage-results-${Date.now()}.pdf`);
}
