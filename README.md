# Mileage Calculator (Client-Side)

A production-focused web app that calculates **round-trip driving mileage** from a home address to every destination in a spreadsheet.

## Features
- Pure client-side HTML/CSS/JavaScript
- openrouteservice routing (`driving-car`) with miles conversion
- Nominatim forward geocoding with throttling + retry
- XLSX/CSV parsing with SheetJS
- Inline editable mileage + instant totals
- Duplicate detection, remove rows, retry failed rows
- localStorage caches for geocodes + route mileage
- sessionStorage API key persistence (tab session only)
- Dracula-inspired responsive UI
- CSV export of final results
- Live openrouteservice quota card from `X-RateLimit-*` response headers

## Quick Start
1. Open `index.html` via a static server (recommended):
   - `python3 -m http.server 8080`
2. Visit `http://localhost:8080`
3. Enter home address and your ORS API key.
4. Upload `data/example-addresses.csv`.
5. Click **Process Addresses**.

## openrouteservice API key
- Sign up: https://openrouteservice.org/dev/#/signup
- Directions docs: https://openrouteservice.org/dev/#/api-docs/v2/directions/{profile}/post
- Paste key into app each session (temporary sessionStorage only).

## Quota detection behavior
The app reads these response headers from ORS routing responses:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

How it works:
- Quota data updates during API key validation and every route request.
- If headers are missing, app continues normally and shows **Quota unavailable**.
- Quota values are held **in memory only** and are not persisted to localStorage.
- HTTP `429` is authoritative: processing halts and partial results remain exportable.

## Quota status thresholds
- **Healthy**: >50% remaining
- **Warning**: 20%–50% remaining
- **Critical**: <20% remaining
- **Exhausted**: `0` remaining or HTTP `429`

## Estimated job cost
Estimated route requests are calculated from:
- Spreadsheet row count
- Duplicate grouping toggle state
- Existing cached distances

This estimate is approximate and may differ from ORS-reported remaining quota due to external usage, reset timing, or server-side accounting.

## Caching strategy
- `localStorage` keys:
  - `mileagecalc:geo:v1`
  - `mileagecalc:dist:v1`
- Cache key is normalized address string (`lowercase`, trimmed, single-space)
- Never cache API keys
- Never persist quota values

## Deployment
### GitHub Pages
- Push files to repo.
- Enable Pages from root or `/docs`.
- Ensure static file hosting only.

### Netlify
- New site from Git.
- Build command: none.
- Publish directory: repository root.

### Vercel
- Import repository.
- Framework preset: Other.
- Build command: none.
- Output directory: `.`

## File structure
- `src/spreadsheetParser.js`
- `src/geocoder.js`
- `src/routingProvider.js`
- `src/cacheManager.js`
- `src/mileageCalculator.js`
- `src/uiRenderer.js`
- `src/quotaService.js`
- `src/rateLimitParser.js`
- `src/requestEstimator.js`
- `src/exportService.js`
- `src/validation.js`
