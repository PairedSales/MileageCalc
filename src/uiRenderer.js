const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const statusClass = (status) => {
  if (!status) return '';
  if (status === 'OK' || status === 'Cached') return 'status-ok';
  if (status === 'Duplicate address') return 'status-dup';
  return 'status-error';
};

const sumIndividual = (appts) => appts.reduce((s, a) => s + (Number(a.finalIndividualMiles) || 0), 0);

const formatChain = (chain, homeAddress) => chain.map(a => a === homeAddress ? 'Home' : a).join(' → ');

export class UIRenderer {
  constructor(el) {
    this.el = el;
    this.mode = 'both';
  }

  setMode(mode) {
    this.mode = mode;
    this.applyModeVisibility();
    if (this.el.modeToggle) {
      this.el.modeToggle.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
    }
  }

  applyModeVisibility() {
    if (!this.el.dayList) return;
    this.el.dayList.classList.remove('mode-individual', 'mode-combined', 'mode-both');
    this.el.dayList.classList.add(`mode-${this.mode}`);
  }

  renderDays(days, homeAddress, handlers) {
    this.el.dayList.innerHTML = '';
    if (!days.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No appointments processed yet. Upload a Date/Address spreadsheet to begin.';
      this.el.dayList.appendChild(empty);
      this.applyModeVisibility();
      return;
    }
    for (const day of days) {
      this.el.dayList.appendChild(this.renderDayCard(day, homeAddress, handlers));
    }
    this.applyModeVisibility();
  }

  renderDayCard(day, homeAddress, handlers) {
    const card = document.createElement('article');
    card.className = 'panel day-card';
    card.dataset.date = day.date;

    const appts = day.appointments;
    const indivTotal = sumIndividual(appts);
    const combined = day.combinedRoute;
    const combinedTotal = Number(combined?.finalMiles) || 0;
    const singleAppt = appts.length === 1;

    const apptList = appts.map((_, i) => `<li>${escapeHtml(appts[i].address)}</li>`).join('');

    const individualRows = appts.map(a => `
      <li data-appt-id="${a.id}" class="trip-row ${a.individualEdited ? 'edited' : ''}">
        <span class="trip-route">Home → ${escapeHtml(a.address)} → Home =</span>
        <input type="number" step="0.01" class="individual-miles" value="${a.finalIndividualMiles ?? ''}" ${a.individualMiles === null ? 'disabled' : ''} aria-label="Individual miles for ${escapeHtml(a.address)}" />
        <span class="miles-label">miles</span>
        <span class="trip-status ${statusClass(a.status)}">${escapeHtml(a.status)}</span>
        <span class="trip-actions">
          <button class="retry-appt" type="button">Retry</button>
          <button class="revert-appt" type="button" ${!a.individualEdited ? 'disabled' : ''}>Revert</button>
          <button class="remove-appt ghost" type="button">Remove</button>
        </span>
      </li>
    `).join('');

    const chainText = combined?.chain?.length ? formatChain(combined.chain, homeAddress) : `Home → … → Home`;
    const combinedRow = `
      <li class="trip-row ${combined?.edited ? 'edited' : ''}">
        <span class="trip-route">${escapeHtml(chainText)} =</span>
        <input type="number" step="0.01" class="combined-miles" value="${combined?.finalMiles ?? ''}" ${combined?.miles == null ? 'disabled' : ''} aria-label="Combined miles for ${escapeHtml(day.date)}" />
        <span class="miles-label">miles</span>
        <span class="trip-status ${statusClass(combined?.status)}">${escapeHtml(combined?.status || '—')}</span>
        <span class="trip-actions">
          <button class="revert-combined" type="button" ${!combined?.edited ? 'disabled' : ''}>Revert</button>
        </span>
      </li>
    `;

    card.innerHTML = `
      <header class="day-header">
        <h2>Date: <time datetime="${escapeHtml(day.date)}">${escapeHtml(day.date)}</time></h2>
        <span class="day-pill">${appts.length} appointment${appts.length === 1 ? '' : 's'}</span>
      </header>
      <div class="day-appointments">
        <h4>Appointments:</h4>
        <ol class="appt-list">${apptList}</ol>
      </div>
      <div class="day-individual" data-section="individual">
        <h4>${singleAppt ? 'Individual Trip:' : 'Individual Trips:'}</h4>
        <ul class="trip-list">${individualRows}</ul>
        <div class="day-subtotal">Total Individual Mileage = <span class="indiv-total">${indivTotal.toFixed(2)}</span> miles</div>
      </div>
      <div class="day-combined" data-section="combined">
        <h4>Combined Trip:</h4>
        <ul class="trip-list">${combinedRow}</ul>
        <div class="day-subtotal">Total Combined Mileage = <span class="combined-total">${combinedTotal.toFixed(2)}</span> miles</div>
      </div>
    `;

    appts.forEach(a => {
      const row = card.querySelector(`li[data-appt-id="${a.id}"]`);
      if (!row) return;
      const input = row.querySelector('.individual-miles');
      input?.addEventListener('input', debounce(() => handlers.onEditIndividual(day.date, a.id, input.value), 150));
      row.querySelector('.retry-appt')?.addEventListener('click', () => handlers.onRetryAppt(day.date, a.id));
      row.querySelector('.revert-appt')?.addEventListener('click', () => handlers.onRevertIndividual(day.date, a.id));
      row.querySelector('.remove-appt')?.addEventListener('click', () => handlers.onRemoveAppt(day.date, a.id));
    });
    const combinedInput = card.querySelector('.combined-miles');
    combinedInput?.addEventListener('input', debounce(() => handlers.onEditCombined(day.date, combinedInput.value), 150));
    card.querySelector('.revert-combined')?.addEventListener('click', () => handlers.onRevertCombined(day.date));

    return card;
  }

  renderPerDayTable(days) {
    if (!this.el.perDaySummary) return;
    if (!days.length) {
      this.el.perDaySummary.innerHTML = '<tr><td colspan="4" class="muted">No data yet.</td></tr>';
      return;
    }
    this.el.perDaySummary.innerHTML = days.map(d => {
      const indiv = sumIndividual(d.appointments).toFixed(2);
      const combined = (Number(d.combinedRoute?.finalMiles) || 0).toFixed(2);
      const addresses = d.appointments.map(a => escapeHtml(a.address)).join(', ');
      return `<tr>
        <td>${escapeHtml(d.date)}</td>
        <td>${addresses}</td>
        <td class="num">${indiv}</td>
        <td class="num">${combined}</td>
      </tr>`;
    }).join('');
  }

  renderSummary(days) {
    const totalAppts = days.reduce((s, d) => s + d.appointments.length, 0);
    const indiv = days.reduce((s, d) => s + sumIndividual(d.appointments), 0);
    const combined = days.reduce((s, d) => s + (Number(d.combinedRoute?.finalMiles) || 0), 0);
    const failed = days.reduce((s, d) => s + d.appointments.filter(a => !['OK', 'Cached', 'Duplicate address'].includes(a.status)).length, 0);
    if (this.el.summaryDays) this.el.summaryDays.textContent = String(days.length);
    if (this.el.summaryAppointments) this.el.summaryAppointments.textContent = String(totalAppts);
    if (this.el.summaryIndividual) this.el.summaryIndividual.textContent = indiv.toFixed(2);
    if (this.el.summaryCombined) this.el.summaryCombined.textContent = combined.toFixed(2);
    if (this.el.summaryFailed) this.el.summaryFailed.textContent = String(failed);
  }

  // Streaming log — appends a single row per event so the user sees progress
  // immediately. Uses appendChild on a tbody so rows are added in DOM-efficient
  // single-element batches rather than re-rendering the whole table.
  appendLogRow(body, ev) {
    if (!body) return;
    const tr = document.createElement('tr');
    let cls = 'evt-ok';
    let date = ev.date || '';
    let origin = ev.origin || '';
    let destination = ev.destination || '';
    let miles = ev.miles != null ? Number(ev.miles).toFixed(2) : '—';
    let status = ev.status || '';

    if (ev.type === 'day-start') {
      cls = 'evt-day';
      origin = `— start of day (${ev.count} appt${ev.count === 1 ? '' : 's'}) —`;
      destination = '';
      miles = '';
      status = '';
    } else if (ev.type === 'day-end') {
      return; // nothing user-visible to add
    } else if (ev.type === 'combined') {
      cls = 'evt-combined';
      origin = 'Combined route';
      destination = (ev.chain && ev.chain.length) ? formatChain(ev.chain, ev.chain[0]) : '—';
    } else if (ev.error || /fail|error|invalid|not found|timeout/i.test(status)) {
      cls = 'evt-error';
    } else if (/cached/i.test(status)) {
      cls = 'evt-cached';
    }

    tr.className = cls;
    tr.innerHTML = `
      <td>${escapeHtml(date)}</td>
      <td>${escapeHtml(origin)}</td>
      <td>${escapeHtml(destination)}</td>
      <td class="num">${escapeHtml(miles)}</td>
      <td class="status-cell">${escapeHtml(status)}</td>
    `;
    body.appendChild(tr);
    // Auto-scroll to keep the latest event visible — only if the user is
    // already near the bottom, so we don't fight them when they scroll up
    // to investigate an earlier row.
    const container = body;
    if (container.scrollHeight - container.scrollTop - container.clientHeight < 80) {
      container.scrollTop = container.scrollHeight;
    }
  }

  clearLog(body) { if (body) body.innerHTML = ''; }

  renderErrors(days) {
    const errors = [];
    for (const d of days) {
      for (const a of d.appointments) {
        if (!['OK', 'Cached', 'Duplicate address'].includes(a.status)) {
          errors.push({ date: d.date, address: a.address, status: a.status });
        }
      }
    }
    if (!this.el.errorPanel) return;
    this.el.errorPanel.hidden = errors.length === 0;
    this.el.errorList.innerHTML = errors.map(e => `<li><strong>${escapeHtml(e.date)}</strong> — ${escapeHtml(e.address)}: ${escapeHtml(e.status)}</li>`).join('');
  }
}
