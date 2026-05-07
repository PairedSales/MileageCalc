# Mileage Calculator (Client-Side)

A production-focused web app that calculates mileage from a home address to destinations in a spreadsheet, now with optional same-day nearby grouping.

## Features
- Spreadsheet parsing for `Address` + `Date` columns (date required)
- Date normalization (`YYYY-MM-DD`, common slash/dash formats, Excel serial dates)
- Toggleable grouping mode: **Group nearby same-day inspections** (default ON, session persisted)
- Same-day cluster detection using 10-mile straight-line Haversine distance
- Connected-component grouping (A-B, B-C chaining groups A/B/C)
- Nearest-neighbor stop ordering inside grouped routes
- openrouteservice driving mileage for all route legs
- Fallback to standalone route calculation if grouped route processing fails
- Inline editable mileage + edited row highlighting
- Extended results/export columns: Date, Group ID, Sequence, Grouped Status
- Summary stats: grouped routes, standalone routes, estimated miles saved, average stops/group
- localStorage caching for geocodes and route legs

## Spreadsheet format
| Column A | Column B |
| --- | --- |
| Address | Date |

Both fields are required for each row.

## Quick Start
1. Run a static server from this project folder, e.g. `python3 -m http.server 8080`
2. Open `http://localhost:8080`
3. Enter home address and ORS API key
4. Upload CSV/XLSX with Address + Date columns
5. Process and optionally toggle grouping on/off for immediate recalculation
