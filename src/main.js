import { parseSpreadsheet } from './spreadsheetParser.js';
import { validateInputs } from './validation.js';
import { CacheManager } from './cacheManager.js';
import { Geocoder } from './geocoder.js';
import { OpenRouteServiceProvider } from './routingProvider.js';
import { processMileage } from './mileageCalculator.js';
import { UIRenderer } from './uiRenderer.js';
import { exportCsv } from './exportService.js';

const el = {
  homeAddress: document.getElementById('homeAddress'), apiKey: document.getElementById('apiKey'), fileInput: document.getElementById('fileInput'),
  processBtn: document.getElementById('processBtn'), exportBtn: document.getElementById('exportBtn'), clearBtn: document.getElementById('clearBtn'),
  progressPanel: document.getElementById('progressPanel'), progressText: document.getElementById('progressText'), progressPercent: document.getElementById('progressPercent'), progressFill: document.getElementById('progressFill'),
  resultsBody: document.getElementById('resultsBody'), summaryProcessed: document.getElementById('summaryProcessed'), summaryMiles: document.getElementById('summaryMiles'), summaryFailed: document.getElementById('summaryFailed'), summaryEdited: document.getElementById('summaryEdited'),
  errorPanel: document.getElementById('errorPanel'), errorList: document.getElementById('errorList')
};
const cache = new CacheManager();
const ui = new UIRenderer(el);
let rows = [];

el.apiKey.value = sessionStorage.getItem('mileagecalc:ors:key') || '';
el.apiKey.addEventListener('input', () => sessionStorage.setItem('mileagecalc:ors:key', el.apiKey.value.trim()));

function renderAll() { ui.render(rows, handlers); ui.renderSummary(rows); ui.renderErrors(rows); el.exportBtn.disabled = rows.length === 0; }

const handlers = {
  onEdit: (id, value) => { const row = rows.find(r => r.id === id); if (!row) return; const n = Number(value); if (Number.isFinite(n) && n >= 0) { row.finalMiles = n; row.edited = row.calculatedMiles !== n; renderAll(); } },
  onRevert: (id) => { const row = rows.find(r => r.id === id); if (!row) return; row.finalMiles = row.calculatedMiles; row.edited = false; renderAll(); },
  onRemove: (id) => { rows = rows.filter(r => r.id !== id); renderAll(); },
  onRetry: async (id) => {
    const row = rows.find(r => r.id === id); if (!row) return;
    const router = new OpenRouteServiceProvider(el.apiKey.value.trim());
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

el.processBtn.addEventListener('click', async () => {
  const file = el.fileInput.files?.[0];
  const homeAddress = el.homeAddress.value.trim();
  const apiKey = el.apiKey.value.trim();
  const errors = validateInputs({ homeAddress, apiKey, file });
  if (errors.length) { alert(errors.join('\n')); return; }

  el.progressPanel.hidden = false;
  const router = new OpenRouteServiceProvider(apiKey);
  try { await router.validateKey(); } catch (e) { alert(e.message); return; }
  const addresses = await parseSpreadsheet(file);
  const geocoder = new Geocoder(cache);
  rows = await processMileage({
    homeAddress, destinations: addresses, geocoder, router, cache,
    onProgress: (done, total, status) => {
      const pct = Math.round((done / total) * 100);
      el.progressText.textContent = `${done}/${total} - ${status}`;
      el.progressPercent.textContent = `${pct}%`;
      el.progressFill.style.width = `${pct}%`;
    }
  });
  renderAll();
});

el.exportBtn.addEventListener('click', () => exportCsv(rows));
el.clearBtn.addEventListener('click', () => { rows = []; el.fileInput.value = ''; el.progressPanel.hidden = true; el.progressFill.style.width = '0%'; renderAll(); });

renderAll();
