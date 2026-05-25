// App entry point — wires together parsing, validation, geocoding,
// routing, and the live UI. Major changes vs. previous version:
//   - All addresses pass through normalizeAddress() before any cache or
//     network access, so we get consistent keys and high cache hit rates.
//   - Processing emits streaming events; each appointment paints into the
//     "Live Activity" panel as soon as its result is known.
//   - The final day-card render still happens at the end (it depends on
//     combined-route totals) but the user has been watching individual
//     results stream in the whole time.

import { parseSpreadsheet } from './spreadsheetParser.js';
import { validateInputs } from './validation.js';
import { CacheManager } from './cacheManager.js';
import { Geocoder } from './geocoder.js';
import { OpenRouteServiceProvider } from './routingProvider.js';
import { processMileage, rebuildCombinedFromCache } from './mileageCalculator.js';
import { UIRenderer } from './uiRenderer.js';
import { exportCsv, exportPdf } from './exportService.js';
import { log } from './logger.js';

const el = {
  homeAddress: document.getElementById('homeAddress'),
  apiKey: document.getElementById('apiKey'),
  apiQuotaStatus: document.getElementById('apiQuotaStatus'),
  fileInput: document.getElementById('fileInput'),
  processBtn: document.getElementById('processBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  stopBtn: document.getElementById('stopBtn'),
  exportBtn: document.getElementById('exportBtn'),
  exportPdfBtn: document.getElementById('exportPdfBtn'),
  clearBtn: document.getElementById('clearBtn'),
  progressPanel: document.getElementById('progressPanel'),
  progressText: document.getElementById('progressText'),
  progressPercent: document.getElementById('progressPercent'),
  progressFill: document.getElementById('progressFill'),
  summaryDays: document.getElementById('summaryDays'),
  summaryAppointments: document.getElementById('summaryAppointments'),
  summaryIndividual: document.getElementById('summaryIndividual'),
  summaryCombined: document.getElementById('summaryCombined'),
  summaryFailed: document.getElementById('summaryFailed'),
  modeToggle: document.getElementById('modeToggle'),
  dayList: document.getElementById('dayList'),
  perDaySummary: document.getElementById('perDaySummary'),
  errorPanel: document.getElementById('errorPanel'),
  errorList: document.getElementById('errorList'),
  liveLogPanel: document.getElementById('liveLogPanel'),
  liveLogBody: document.getElementById('liveLogBody'),
  clearLogBtn: document.getElementById('clearLogBtn')
};

const cache = new CacheManager();
const ui = new UIRenderer(el);
let days = [];
let currentAbortController = null;
const pauseState = { paused: false };
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function updateQuotaStatus() {
  const key = el.apiKey.value.trim();
  if (!key) {
    if (el.apiQuotaStatus) el.apiQuotaStatus.textContent = '';
    return;
  }
  if (el.apiQuotaStatus) el.apiQuotaStatus.textContent = 'Checking quota…';
  const router = new OpenRouteServiceProvider(key);
  const quota = await router.getQuota();
  if (quota && el.apiQuotaStatus) {
    const refreshDate = new Date(quota.reset * 1000);
    const timeStr = refreshDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.apiQuotaStatus.textContent = `${quota.remaining}/${quota.limit} remaining. Refreshes at ${timeStr}.`;
  } else if (el.apiQuotaStatus) {
    el.apiQuotaStatus.textContent = 'Quota status unavailable';
  }
}
const debouncedUpdateQuotaStatus = debounce(updateQuotaStatus, 500);

el.apiKey.value = sessionStorage.getItem('mileagecalc:ors:key') || '';
el.apiKey.addEventListener('input', () => {
  sessionStorage.setItem('mileagecalc:ors:key', el.apiKey.value.trim());
  debouncedUpdateQuotaStatus();
});
if (el.apiKey.value) updateQuotaStatus();

function renderAll() {
  const home = el.homeAddress.value.trim();
  ui.renderDays(days, home, handlers);
  ui.renderPerDayTable(days);
  ui.renderSummary(days);
  ui.renderErrors(days);
  el.exportBtn.disabled = days.length === 0;
  el.exportPdfBtn.disabled = days.length === 0;
}

function findAppt(date, id) {
  const day = days.find(d => d.date === date);
  if (!day) return { day: null, appt: null };
  return { day, appt: day.appointments.find(a => a.id === id) || null };
}

function refreshCombinedFromCache(day) {
  const home = el.homeAddress.value.trim();
  const rebuilt = rebuildCombinedFromCache(day.appointments, home, cache);
  if (rebuilt.status === 'OK') day.combinedRoute = rebuilt;
}

const handlers = {
  onEditIndividual: (date, id, value) => {
    const { appt } = findAppt(date, id);
    if (!appt) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    appt.finalIndividualMiles = Number(n.toFixed(2));
    appt.individualEdited = appt.individualMiles !== appt.finalIndividualMiles;
    renderAll();
  },
  onRevertIndividual: (date, id) => {
    const { appt } = findAppt(date, id);
    if (!appt || appt.individualMiles == null) return;
    appt.finalIndividualMiles = appt.individualMiles;
    appt.individualEdited = false;
    renderAll();
  },
  onEditCombined: (date, value) => {
    const day = days.find(d => d.date === date);
    if (!day?.combinedRoute) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    day.combinedRoute.finalMiles = Number(n.toFixed(2));
    day.combinedRoute.edited = day.combinedRoute.miles !== day.combinedRoute.finalMiles;
    renderAll();
  },
  onRevertCombined: (date) => {
    const day = days.find(d => d.date === date);
    if (!day?.combinedRoute || day.combinedRoute.miles == null) return;
    day.combinedRoute.finalMiles = day.combinedRoute.miles;
    day.combinedRoute.edited = false;
    renderAll();
  },
  onRemoveAppt: (date, id) => {
    const day = days.find(d => d.date === date);
    if (!day) return;
    day.appointments = day.appointments.filter(a => a.id !== id);
    if (!day.appointments.length) {
      days = days.filter(d => d.date !== date);
    } else {
      refreshCombinedFromCache(day);
    }
    renderAll();
  },
  onRetryAppt: async (date, id) => {
    const { day, appt } = findAppt(date, id);
    if (!day || !appt) return;
    const home = el.homeAddress.value.trim();
    const apiKey = el.apiKey.value.trim();
    if (!home || !apiKey) { alert('Home address and API key are required to retry.'); return; }
    const router = new OpenRouteServiceProvider(apiKey);
    const geocoder = new Geocoder(cache);
    try {
      const homeGeo = await geocoder.geocode(home);
      const destGeo = await geocoder.geocode(appt.rawAddress);
      const oneWay = await router.getMiles(homeGeo, destGeo);
      cache.setSegmentMiles(home, appt.address, oneWay);
      cache.setSegmentMiles(appt.address, home, oneWay);
      appt.homeOneWayMiles = oneWay;
      appt.individualMiles = Number((oneWay * 2).toFixed(2));
      appt.finalIndividualMiles = appt.individualMiles;
      appt.individualEdited = false;
      appt.status = 'OK';
      refreshCombinedFromCache(day);
      ui.appendLogRow(el.liveLogBody, { type: 'appointment', date, origin: home, destination: appt.address, miles: appt.individualMiles, status: 'Retry OK' });
    } catch (e) {
      appt.status = e.message;
      ui.appendLogRow(el.liveLogBody, { type: 'appointment', date, origin: home, destination: appt.address, miles: null, status: e.message, error: true });
    }
    renderAll();
  }
};

el.modeToggle?.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => ui.setMode(btn.dataset.mode));
});
ui.setMode('both');

el.clearLogBtn?.addEventListener('click', () => ui.clearLog(el.liveLogBody));

el.stopBtn?.addEventListener('click', () => {
  if (currentAbortController) {
    currentAbortController.abort();
  }
});

el.pauseBtn?.addEventListener('click', () => {
  pauseState.paused = !pauseState.paused;
  el.pauseBtn.textContent = pauseState.paused ? 'Resume' : 'Pause';
});

el.processBtn.addEventListener('click', async () => {
  const file = el.fileInput.files?.[0];
  const homeAddress = el.homeAddress.value.trim();
  const apiKey = el.apiKey.value.trim();
  const errors = validateInputs({ homeAddress, apiKey, file });
  if (errors.length) { alert(errors.join('\n')); return; }

  el.progressPanel.hidden = false;
  el.liveLogPanel.hidden = false;
  ui.clearLog(el.liveLogBody);
  el.progressText.textContent = 'Validating API key…';
  el.progressPercent.textContent = '0%';
  el.progressFill.style.width = '0%';

  el.processBtn.disabled = true;
  el.pauseBtn.disabled = false;
  pauseState.paused = false;
  el.pauseBtn.textContent = 'Pause';
  el.stopBtn.disabled = false;
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  const router = new OpenRouteServiceProvider(apiKey);
  try {
    await router.validateKey();
    log.info('API key validated.');
  } catch (e) {
    alert(e.message);
    el.progressPanel.hidden = true;
    el.processBtn.disabled = false;
    el.pauseBtn.disabled = true;
    el.stopBtn.disabled = true;
    return;
  }

  let appointments;
  try {
    appointments = await parseSpreadsheet(file);
    log.info(`parsed ${appointments.length} appointment rows`);
  } catch (e) {
    alert(e.message);
    el.progressPanel.hidden = true;
    el.processBtn.disabled = false;
    el.pauseBtn.disabled = true;
    el.stopBtn.disabled = true;
    return;
  }
  if (!appointments.length) {
    alert('No appointments found in spreadsheet.');
    el.progressPanel.hidden = true;
    el.processBtn.disabled = false;
    el.pauseBtn.disabled = true;
    el.stopBtn.disabled = true;
    return;
  }

  const geocoder = new Geocoder(cache);
  try {
    days = await processMileage({
      homeAddress, appointments, geocoder, router, cache, signal, pauseState,
      // Stream incremental progress percentage to the progress bar.
      onProgress: (done, total, status) => {
        const pct = total ? Math.round((done / total) * 100) : 0;
        el.progressText.textContent = `${done}/${total} - ${status}`;
        el.progressPercent.textContent = `${pct}%`;
        el.progressFill.style.width = `${pct}%`;
      },
      // Stream individual events into the Live Activity table so the user
      // can watch every date / origin / destination / mileage / status pair
      // as it's resolved, without waiting for the whole batch.
      onEvent: (ev) => ui.appendLogRow(el.liveLogBody, ev)
    });
    el.progressText.textContent = 'Done';
    el.progressPercent.textContent = '100%';
    el.progressFill.style.width = '100%';
    log.info('processing complete');
  } catch (e) {
    if (e.name === 'AbortError' || e.message === 'Aborted by user') {
      log.info('processing aborted by user');
      el.progressText.textContent = 'Aborted';
    } else {
      log.error('processing failed:', e.message);
      alert(`Processing failed: ${e.message}`);
    }
  } finally {
    el.processBtn.disabled = false;
    el.pauseBtn.disabled = true;
    el.stopBtn.disabled = true;
  }
  renderAll();
});

el.exportBtn.addEventListener('click', () => exportCsv(days));
el.exportPdfBtn.addEventListener('click', () => exportPdf(days));
el.clearBtn.addEventListener('click', () => {
  days = [];
  el.fileInput.value = '';
  el.progressPanel.hidden = true;
  el.liveLogPanel.hidden = true;
  ui.clearLog(el.liveLogBody);
  el.progressFill.style.width = '0%';
  el.progressText.textContent = 'Waiting…';
  el.progressPercent.textContent = '0%';
  renderAll();
});

renderAll();
