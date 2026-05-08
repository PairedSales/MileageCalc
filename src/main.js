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
  homeAddress: document.getElementById('homeAddress'), apiKey: document.getElementById('apiKey'), fileInput: document.getElementById('fileInput'), groupDuplicates: document.getElementById('groupDuplicates'),
  processBtn: document.getElementById('processBtn'), exportBtn: document.getElementById('exportBtn'), clearBtn: document.getElementById('clearBtn'),
  progressPanel: document.getElementById('progressPanel'), progressText: document.getElementById('progressText'), progressPercent: document.getElementById('progressPercent'), progressFill: document.getElementById('progressFill'),
  resultsBody: document.getElementById('resultsBody'), summaryProcessed: document.getElementById('summaryProcessed'), summaryMiles: document.getElementById('summaryMiles'), summaryFailed: document.getElementById('summaryFailed'), summaryEdited: document.getElementById('summaryEdited'),
  errorPanel: document.getElementById('errorPanel'), errorList: document.getElementById('errorList'),
  quotaCard: document.getElementById('quotaCard'), quotaRemaining: document.getElementById('quotaRemaining'), quotaLimit: document.getElementById('quotaLimit'), quotaEstimate: document.getElementById('quotaEstimate'), quotaStatus: document.getElementById('quotaStatus'), quotaUpdated: document.getElementById('quotaUpdated'), quotaLoading: document.getElementById('quotaLoading')
};
const cache = new CacheManager();
const ui = new UIRenderer(el);
const quotaService = new QuotaService((quota) => ui.renderQuota(quota));
let rows = [];
let addresses = [];

el.apiKey.value = sessionStorage.getItem('mileagecalc:ors:key') || '';

const debounce = (fn, ms = 350) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };

const refreshQuotaFromKey = debounce(async () => {
  const apiKey = el.apiKey.value.trim();
  sessionStorage.setItem('mileagecalc:ors:key', apiKey);
  if (!apiKey) { quotaService.resetQuota(); return; }
  quotaService.setLoading(true);
  const router = new OpenRouteServiceProvider(apiKey, { onResponse: (res) => quotaService.updateFromResponse(res) });
  try { await router.validateKey(); } catch (e) { quotaService.setLoading(false); }
}, 450);

el.apiKey.addEventListener('input', refreshQuotaFromKey);

function renderAll() { ui.render(rows, handlers); ui.renderSummary(rows); ui.renderErrors(rows); el.exportBtn.disabled = rows.length === 0; }
function refreshEstimate() { quotaService.setEstimate(estimateRequests({ destinations: addresses, homeAddress: el.homeAddress.value.trim(), cache, groupDuplicates: el.groupDuplicates.checked })); }

const handlers = {
  onEdit: (id, value) => { const row = rows.find(r => r.id === id); if (!row) return; const n = Number(value); if (Number.isFinite(n) && n >= 0) { row.finalMiles = n; row.edited = row.calculatedMiles !== n; renderAll(); } },
  onRevert: (id) => { const row = rows.find(r => r.id === id); if (!row) return; row.finalMiles = row.calculatedMiles; row.edited = false; renderAll(); },
  onRemove: (id) => { rows = rows.filter(r => r.id !== id); renderAll(); },
  onRetry: async (id) => {
    const row = rows.find(r => r.id === id); if (!row) return;
    const router = new OpenRouteServiceProvider(el.apiKey.value.trim(), { onResponse: (res) => quotaService.updateFromResponse(res) });
    const geocoder = new Geocoder(cache);
    try {
      const home = await geocoder.geocode(el.homeAddress.value.trim());
      const dest = await geocoder.geocode(row.address);
      const miles = (await router.getMiles(home, dest)) * 2;
      row.calculatedMiles = Number(miles.toFixed(2)); row.finalMiles = row.calculatedMiles; row.edited = false; row.status = 'OK';
      cache.setDistance(el.homeAddress.value.trim(), row.address, miles);
    } catch (e) { row.status = e.message; }
    renderAll();
  }
};

el.fileInput.addEventListener('change', async () => {
  const file = el.fileInput.files?.[0];
  addresses = file ? await parseSpreadsheet(file) : [];
  refreshEstimate();
});
el.groupDuplicates.addEventListener('change', refreshEstimate);

el.processBtn.addEventListener('click', async () => {
  const file = el.fileInput.files?.[0];
  const homeAddress = el.homeAddress.value.trim();
  const apiKey = el.apiKey.value.trim();
  const errors = validateInputs({ homeAddress, apiKey, file });
  if (errors.length) { alert(errors.join('\n')); return; }

  el.progressPanel.hidden = false;
  const router = new OpenRouteServiceProvider(apiKey, { onResponse: (res) => quotaService.updateFromResponse(res) });
  try { await router.validateKey(); } catch (e) { alert(e.message); return; }
  if (!addresses.length) addresses = await parseSpreadsheet(file);
  refreshEstimate();
  const geocoder = new Geocoder(cache);
  rows = await processMileage({
    homeAddress, destinations: addresses, geocoder, router, cache, groupDuplicates: el.groupDuplicates.checked,
    onProgress: (done, total, status) => {
      const pct = Math.round((done / total) * 100);
      el.progressText.textContent = `${done}/${total} - ${status}`;
      el.progressPercent.textContent = `${pct}%`;
      el.progressFill.style.width = `${pct}%`;
    }
  });
  if (rows.some(r => r.status.includes('quota exhausted'))) {
    alert('API quota exhausted. Processing stopped before completion.');
  }
  renderAll();
});

el.exportBtn.addEventListener('click', () => exportCsv(rows));
el.clearBtn.addEventListener('click', () => { rows = []; addresses = []; el.fileInput.value = ''; el.progressPanel.hidden = true; el.progressFill.style.width = '0%'; refreshEstimate(); renderAll(); });

if (el.apiKey.value.trim()) refreshQuotaFromKey();
else quotaService.emit();
renderAll();
