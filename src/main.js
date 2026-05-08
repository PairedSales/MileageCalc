import { parseSpreadsheet } from './spreadsheetParser.js';
import { validateInputs } from './validation.js';
import { CacheManager } from './cacheManager.js';
import { Geocoder } from './geocoder.js';
import { OpenRouteServiceProvider } from './routingProvider.js';
import { processMileage } from './mileageCalculator.js';
import { UIRenderer } from './uiRenderer.js';
import { exportCsv } from './exportService.js';
import { QuotaService } from './quotaService.js';
import { estimateRequests } from './requestEstimator.js';

const el = {
  homeAddress: document.getElementById('homeAddress'),
  apiKey: document.getElementById('apiKey'),
  fileInput: document.getElementById('fileInput'),
  groupToggle: document.getElementById('groupToggle'),
  processBtn: document.getElementById('processBtn'),
  exportBtn: document.getElementById('exportBtn'),
  clearBtn: document.getElementById('clearBtn'),
  progressPanel: document.getElementById('progressPanel'),
  progressText: document.getElementById('progressText'),
  progressPercent: document.getElementById('progressPercent'),
  progressFill: document.getElementById('progressFill'),
  resultsBody: document.getElementById('resultsBody'),
  summaryProcessed: document.getElementById('summaryProcessed'),
  summaryMiles: document.getElementById('summaryMiles'),
  summaryFailed: document.getElementById('summaryFailed'),
  summaryEdited: document.getElementById('summaryEdited'),
  summaryGrouped: document.getElementById('summaryGrouped'),
  summaryStandalone: document.getElementById('summaryStandalone'),
  summarySaved: document.getElementById('summarySaved'),
  summaryAvgStops: document.getElementById('summaryAvgStops'),
  errorPanel: document.getElementById('errorPanel'),
  errorList: document.getElementById('errorList'),
  quotaCard: document.getElementById('quotaCard'),
  quotaRemaining: document.getElementById('quotaRemaining'),
  quotaLimit: document.getElementById('quotaLimit'),
  quotaEstimate: document.getElementById('quotaEstimate'),
  quotaStatus: document.getElementById('quotaStatus'),
  quotaUpdated: document.getElementById('quotaUpdated'),
  quotaLoading: document.getElementById('quotaLoading')
};

const cache = new CacheManager();
const ui = new UIRenderer(el);
const quotaService = new QuotaService((quota) => ui.renderQuota(quota));
let rows = [];
let parsedDestinations = [];

el.apiKey.value = sessionStorage.getItem('mileagecalc:ors:key') || '';
el.groupToggle.checked = sessionStorage.getItem('mileagecalc:grouping') !== 'off';
el.apiKey.addEventListener('input', () => sessionStorage.setItem('mileagecalc:ors:key', el.apiKey.value.trim()));

function renderAll() {
  ui.render(rows, handlers);
  ui.renderSummary(rows);
  ui.renderErrors(rows);
  el.exportBtn.disabled = rows.length === 0;
}

function refreshEstimate() {
  quotaService.setEstimate(
    estimateRequests({
      destinations: parsedDestinations,
      homeAddress: el.homeAddress.value.trim(),
      cache,
      groupNearbySameDay: el.groupToggle.checked
    })
  );
}

async function recalcFromParsed() {
  if (!parsedDestinations.length) return;
  const router = new OpenRouteServiceProvider(el.apiKey.value.trim());
  const geocoder = new Geocoder(cache);
  rows = await processMileage({
    homeAddress: el.homeAddress.value.trim(),
    destinations: parsedDestinations,
    geocoder,
    router,
    cache,
    groupNearbySameDay: el.groupToggle.checked
  });
  renderAll();
}

const handlers = {
  onEdit: (id, value) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) {
      row.finalMiles = n;
      row.edited = row.calculatedMiles !== n;
      renderAll();
    }
  },
  onRevert: (id) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    row.finalMiles = row.calculatedMiles;
    row.edited = false;
    renderAll();
  },
  onRemove: (id) => {
    rows = rows.filter((r) => r.id !== id);
    renderAll();
  },
  onRetry: recalcFromParsed
};

el.fileInput.addEventListener('change', async () => {
  const file = el.fileInput.files?.[0];
  parsedDestinations = file ? await parseSpreadsheet(file) : [];
  refreshEstimate();
});

el.groupToggle.addEventListener('change', async () => {
  sessionStorage.setItem('mileagecalc:grouping', el.groupToggle.checked ? 'on' : 'off');
  refreshEstimate();
  await recalcFromParsed();
});

el.processBtn.addEventListener('click', async () => {
  const file = el.fileInput.files?.[0];
  const homeAddress = el.homeAddress.value.trim();
  const apiKey = el.apiKey.value.trim();
  const errors = validateInputs({ homeAddress, apiKey, file });
  if (errors.length) {
    alert(errors.join('\n'));
    return;
  }

  el.progressPanel.hidden = false;
  const router = new OpenRouteServiceProvider(apiKey, { onResponse: (res) => quotaService.updateFromResponse(res) });
  try {
    await router.validateKey();
  } catch (e) {
    alert(e.message);
    return;
  }

  try {
    parsedDestinations = await parseSpreadsheet(file);
  } catch (e) {
    alert(`Spreadsheet parse error: ${e.message}`);
    return;
  }

  refreshEstimate();

  const geocoder = new Geocoder(cache);
  rows = await processMileage({
    homeAddress,
    destinations: parsedDestinations,
    geocoder,
    router,
    cache,
    groupNearbySameDay: el.groupToggle.checked,
    onProgress: (done, total, status) => {
      const pct = Math.round((done / total) * 100);
      el.progressText.textContent = `${done}/${total} - ${status}`;
      el.progressPercent.textContent = `${pct}%`;
      el.progressFill.style.width = `${pct}%`;
    }
  });

  if (rows.some((r) => r.status.includes('quota exhausted'))) {
    alert('API quota exhausted. Processing stopped before completion.');
  }
  renderAll();
});

el.exportBtn.addEventListener('click', () => exportCsv(rows));
el.clearBtn.addEventListener('click', () => {
  rows = [];
  parsedDestinations = [];
  el.fileInput.value = '';
  el.progressPanel.hidden = true;
  el.progressFill.style.width = '0%';
  refreshEstimate();
  renderAll();
});

quotaService.emit();
renderAll();
