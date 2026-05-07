const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export class UIRenderer {
  constructor(elements) { this.el = elements; }
  render(rows, handlers) {
    this.el.resultsBody.innerHTML = '';
    rows.forEach(row => {
      const tr = document.createElement('tr');
      if (row.edited) tr.classList.add('edited');
      if (row.grouped) tr.classList.add('grouped');
      tr.innerHTML = `<td>${row.address}</td>
        <td>${row.date || '—'}</td>
        <td>${row.groupId || '—'}</td>
        <td>${row.sequence || '—'}</td>
        <td>${row.grouped ? 'Grouped' : 'Standalone'}</td>
        <td>${row.calculatedMiles ?? '—'}</td>
        <td><input type='number' step='0.01' value='${row.finalMiles ?? ''}' ${row.calculatedMiles === null ? 'disabled' : ''} /></td>
        <td class='${row.status === 'OK' || row.status === 'Cached' || row.status.startsWith('Fallback') ? 'status-ok' : row.status.startsWith('Duplicate') ? 'status-dup' : 'status-error'}'>${row.status}</td>
        <td><button class='retry'>Retry</button> <button class='revert' ${!row.edited ? 'disabled' : ''}>Revert</button> <button class='remove ghost'>Remove</button></td>`;
      const milesInput = tr.querySelector('input');
      milesInput?.addEventListener('input', debounce(() => handlers.onEdit(row.id, milesInput.value), 150));
      tr.querySelector('.revert').addEventListener('click', () => handlers.onRevert(row.id));
      tr.querySelector('.remove').addEventListener('click', () => handlers.onRemove(row.id));
      tr.querySelector('.retry').addEventListener('click', () => handlers.onRetry(row.id));
      this.el.resultsBody.appendChild(tr);
    });
  }
  renderSummary(rows) {
    const processed = rows.length;
    const failed = rows.filter(r => !['OK', 'Cached'].includes(r.status) && !r.status?.startsWith('Fallback')).length;
    const edited = rows.filter(r => r.edited).length;
    const miles = rows.reduce((sum, r) => sum + (Number(r.finalMiles) || 0), 0);
    const groupedIds = new Set(rows.filter(r => r.groupId).map(r => r.groupId));
    const standalone = rows.filter(r => !r.grouped).length;
    const groupedRows = rows.filter(r => r.grouped);
    const avgStops = groupedIds.size ? groupedRows.length / groupedIds.size : 0;
    const baseline = rows.reduce((sum, r) => sum + (Number(r.baselineMiles) || Number(r.finalMiles) || 0), 0);
    this.el.summaryProcessed.textContent = String(processed);
    this.el.summaryFailed.textContent = String(failed);
    this.el.summaryEdited.textContent = String(edited);
    this.el.summaryMiles.textContent = miles.toFixed(2);
    this.el.summaryGrouped.textContent = String(groupedIds.size);
    this.el.summaryStandalone.textContent = String(standalone);
    this.el.summarySaved.textContent = Math.max(0, baseline - miles).toFixed(2);
    this.el.summaryAvgStops.textContent = avgStops.toFixed(2);
  }
  renderErrors(rows) {
    const errors = rows.filter(r => !['OK', 'Cached'].includes(r.status) && !r.status?.startsWith('Fallback'));
    this.el.errorPanel.hidden = errors.length === 0;
    this.el.errorList.innerHTML = errors.map(e => `<li>${e.address}: ${e.status}</li>`).join('');
  }
}
