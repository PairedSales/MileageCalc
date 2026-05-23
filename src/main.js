import { parseSpreadsheet } from './spreadsheetParser.js';
import { validateInputs } from './validation.js';
import { CacheManager } from './cacheManager.js';
import { Geocoder } from './geocoder.js';
import { OpenRouteServiceProvider } from './routingProvider.js';
import { processMileage, rebuildCombinedFromCache } from './mileageCalculator.js';
import { UIRenderer } from './uiRenderer.js';
import { exportCsv } from './exportService.js';

const el = {
  homeAddress: document.getElementById('homeAddress'),
  apiKey: document.getElementById('apiKey'),
  fileInput: document.getElementById('fileInput'),
  processBtn: document.getElementById('processBtn'),
  exportBtn: document.getElementById('exportBtn'),
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
  errorList: document.getElementById('errorList')
};

const cache = new CacheManager();
const ui = new UIRenderer(el);
let days = [];

el.apiKey.value = sessionStorage.getItem('mileagecalc:ors:key') || '';
el.apiKey.addEventListener('input', () => sessionStorage.setItem('mileagecalc:ors:key', el.apiKey.value.trim()));

function renderAll() {
  const home = el.homeAddress.value.trim();
  ui.renderDays(days, home, handlers);
  ui.renderPerDayTable(days);
  ui.renderSummary(days);
  ui.renderErrors(days);
  el.exportBtn.disabled = days.length === 0;
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
      const destGeo = await geocoder.geocode(appt.address);
      const oneWay = await router.getMiles(homeGeo, destGeo);
      cache.setSegmentMiles(home, appt.address, oneWay);
      cache.setSegmentMiles(appt.address, home, oneWay);
      appt.homeOneWayMiles = oneWay;
      appt.individualMiles = Number((oneWay * 2).toFixed(2));
      appt.finalIndividualMiles = appt.individualMiles;
      appt.individualEdited = false;
      appt.status = 'OK';
      refreshCombinedFromCache(day);
    } catch (e) {
      appt.status = e.message;
    }
    renderAll();
  }
};

el.modeToggle?.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => ui.setMode(btn.dataset.mode));
});
ui.setMode('both');

el.processBtn.addEventListener('click', async () => {
  const file = el.fileInput.files?.[0];
  const homeAddress = el.homeAddress.value.trim();
  const apiKey = el.apiKey.value.trim();
  const errors = validateInputs({ homeAddress, apiKey, file });
  if (errors.length) { alert(errors.join('\n')); return; }

  el.progressPanel.hidden = false;
  el.progressText.textContent = 'Validating API key…';
  el.progressPercent.textContent = '0%';
  el.progressFill.style.width = '0%';

  const router = new OpenRouteServiceProvider(apiKey);
  try { await router.validateKey(); } catch (e) { alert(e.message); el.progressPanel.hidden = true; return; }

  let appointments;
  try {
    appointments = await parseSpreadsheet(file);
  } catch (e) {
    alert(e.message);
    el.progressPanel.hidden = true;
    return;
  }
  if (!appointments.length) {
    alert('No appointments found in spreadsheet.');
    el.progressPanel.hidden = true;
    return;
  }

  const geocoder = new Geocoder(cache);
  try {
    days = await processMileage({
      homeAddress, appointments, geocoder, router, cache,
      onProgress: (done, total, status) => {
        const pct = total ? Math.round((done / total) * 100) : 0;
        el.progressText.textContent = `${done}/${total} - ${status}`;
        el.progressPercent.textContent = `${pct}%`;
        el.progressFill.style.width = `${pct}%`;
      }
    });
    el.progressText.textContent = 'Done';
    el.progressPercent.textContent = '100%';
    el.progressFill.style.width = '100%';
  } catch (e) {
    alert(`Processing failed: ${e.message}`);
  }
  renderAll();
});

el.exportBtn.addEventListener('click', () => exportCsv(days));
el.clearBtn.addEventListener('click', () => {
  days = [];
  el.fileInput.value = '';
  el.progressPanel.hidden = true;
  el.progressFill.style.width = '0%';
  el.progressText.textContent = 'Waiting…';
  el.progressPercent.textContent = '0%';
  renderAll();
});

renderAll();
