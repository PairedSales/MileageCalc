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

## Free-tier limits & usage planning
Check your account dashboard for current limits; limits can change. Typical usage for one destination:
- 1 geocode call for destination (cached after first success)
- 1 route call for home→destination (round-trip doubled locally)
- 0 extra calls if cached

For 1,000 new addresses expect roughly:
- ~1,001 geocode calls (incl. home once)
- ~1,000 route calls

## Recommended throttling strategy
- Nominatim: 1+ second delay between requests
- Retry transient errors with exponential backoff
- Keep small async gaps to keep UI responsive

## Caching strategy
- `localStorage` keys:
  - `mileagecalc:geo:v1`
  - `mileagecalc:dist:v1`
- Cache key is normalized address string (`lowercase`, trimmed, single-space)
- Never cache API keys

## Scaling path (self-host OSRM)
If you outgrow hosted limits:
1. Deploy OSRM with regional extracts.
2. Replace provider layer implementation while keeping `processMileage` untouched.
3. Add a `OsrmProvider` class matching provider interface.

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
- `src/exportService.js`
- `src/validation.js`
