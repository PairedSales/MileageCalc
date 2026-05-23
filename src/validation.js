// Address validation, cleaning, and normalization.
//
// All addresses are passed through `normalizeAddress` before they are used for
// caching, geocoding, or routing. This single canonical form gives us:
//   - far higher cache hit rates (e.g. "1 e wacker dr." == "1 East Wacker Drive")
//   - stable keys for de-duplicated geocode/route requests within a session
//   - early detection of obviously malformed input before any network call
//
// We intentionally do NOT mutate or drop the user's original string — the
// normalized form is used internally; the original is still displayed.

export function validateInputs({ homeAddress, apiKey, file }) {
  const errors = [];
  if (!homeAddress?.trim()) errors.push('Home address is required.');
  else {
    const v = validateAddress(homeAddress);
    if (!v.valid) errors.push(`Home address looks invalid: ${v.reason}`);
  }
  if (!apiKey?.trim()) errors.push('openrouteservice API key is required.');
  if (!file) errors.push('Please upload a CSV/XLSX file.');
  return errors;
}

// USPS street suffix abbreviations -> canonical short form.
// Kept short — covers the suffixes that appear in real-world US addresses.
const STREET_SUFFIX = {
  STREET: 'St', ST: 'St',
  AVENUE: 'Ave', AVE: 'Ave', AV: 'Ave',
  ROAD: 'Rd', RD: 'Rd',
  BOULEVARD: 'Blvd', BLVD: 'Blvd', BOUL: 'Blvd',
  DRIVE: 'Dr', DR: 'Dr', DRV: 'Dr',
  LANE: 'Ln', LN: 'Ln',
  COURT: 'Ct', CT: 'Ct',
  CIRCLE: 'Cir', CIR: 'Cir',
  PLACE: 'Pl', PL: 'Pl',
  PARKWAY: 'Pkwy', PKWY: 'Pkwy',
  HIGHWAY: 'Hwy', HWY: 'Hwy',
  TERRACE: 'Ter', TER: 'Ter',
  TRAIL: 'Trl', TRL: 'Trl',
  SQUARE: 'Sq', SQ: 'Sq',
  WAY: 'Way',
  EXPRESSWAY: 'Expy', EXPY: 'Expy'
};

const DIRECTIONAL = {
  NORTH: 'N', N: 'N',
  SOUTH: 'S', S: 'S',
  EAST: 'E', E: 'E',
  WEST: 'W', W: 'W',
  NORTHEAST: 'NE', NE: 'NE',
  NORTHWEST: 'NW', NW: 'NW',
  SOUTHEAST: 'SE', SE: 'SE',
  SOUTHWEST: 'SW', SW: 'SW'
};

// Unit-style designators get normalized to their USPS-preferred short form.
const UNIT_DESIGNATOR = {
  APARTMENT: 'Apt', APT: 'Apt',
  SUITE: 'Ste', STE: 'Ste',
  UNIT: 'Unit',
  ROOM: 'Rm', RM: 'Rm',
  FLOOR: 'Fl', FL: 'Fl',
  BUILDING: 'Bldg', BLDG: 'Bldg'
};

// US state abbreviations — accepted as-is. Full state names get collapsed
// to the two-letter form so geocoding gets a consistent input.
const US_STATES = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO',
  MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND',
  OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI',
  WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC', DC: 'DC'
};
const US_STATE_CODES = new Set(Object.values(US_STATES));

// Title-case a single token but preserve common all-caps abbreviations
// (state codes, directionals) and ordinal suffixes like "1st", "23rd".
function titleCaseToken(tok) {
  const upper = tok.toUpperCase();
  if (US_STATE_CODES.has(upper) && tok.length === 2) return upper;
  if (DIRECTIONAL[upper] && upper.length <= 2) return upper;
  if (/^\d/.test(tok)) return tok.toLowerCase(); // 1st, 23rd, 100 -> keep digits, lower the suffix
  // Hyphenated tokens: title-case each part
  if (tok.includes('-')) return tok.split('-').map(titleCaseToken).join('-');
  return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
}

function cleanZip(raw) {
  if (!raw) return '';
  const m = String(raw).match(/(\d{5})(?:[-\s]?(\d{4}))?/);
  if (!m) return '';
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

// Core normalizer. Single pass: trim, collapse whitespace, fix punctuation,
// then walk tokens applying suffix/directional/state/unit rules.
export function normalizeAddress(raw) {
  if (raw == null) return '';
  let s = String(raw)
    .replace(/[‐-―]/g, '-')        // unicode dashes -> hyphen
    .replace(/[‘’]/g, "'")          // smart quotes -> ascii
    .replace(/[“”]/g, '"')
    .replace(/[.,]/g, ' ')                    // strip commas/periods (we re-comma at the end)
    .replace(/#/g, ' ')                       // "#3B" -> " 3B" so unit handling works
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';

  const tokens = s.split(' ');

  // Pull off a trailing ZIP if present.
  let zip = '';
  const last = tokens[tokens.length - 1];
  const zipMatch = last && last.match(/^\d{5}(?:-\d{4})?$/);
  if (zipMatch) { zip = cleanZip(tokens.pop()); }
  else if (tokens.length >= 2) {
    // ZIP that got split like "60601" "1234"
    const combined = `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`;
    const m = combined.match(/^(\d{5})\s+(\d{4})$/);
    if (m) { zip = `${m[1]}-${m[2]}`; tokens.pop(); tokens.pop(); }
  }

  // Pull off a trailing state code/name.
  let state = '';
  if (tokens.length) {
    const tail1 = tokens[tokens.length - 1].toUpperCase();
    if (US_STATES[tail1]) { state = US_STATES[tail1]; tokens.pop(); }
    else if (tokens.length >= 2) {
      const tail2 = `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`.toUpperCase();
      if (US_STATES[tail2]) { state = US_STATES[tail2]; tokens.pop(); tokens.pop(); }
    }
  }

  // Now walk the remaining tokens applying directional / suffix / unit rules.
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const upper = t.toUpperCase();
    if (DIRECTIONAL[upper]) { out.push(DIRECTIONAL[upper]); continue; }
    if (STREET_SUFFIX[upper]) { out.push(STREET_SUFFIX[upper]); continue; }
    if (UNIT_DESIGNATOR[upper]) { out.push(UNIT_DESIGNATOR[upper]); continue; }
    out.push(titleCaseToken(t));
  }

  // Reassemble with a comma before state for clarity ("123 Main St, Chicago IL 60601").
  // City is whatever sits between the last street-suffix and the state.
  let body = out.join(' ');
  const parts = [body];
  if (state) parts.push(state);
  let assembled = parts.join(', ');
  if (zip) assembled += ` ${zip}`;
  return assembled.replace(/\s+/g, ' ').trim();
}

// Cheap normalized cache key. Lowercased + punctuation-stripped so callers
// don't have to think about casing or punctuation drift.
export function cacheKey(address) {
  return normalizeAddress(address)
    .toLowerCase()
    .replace(/[,.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Detects addresses that are too sparse to bother sending to the geocoder.
// Catches: empty, digit-only, no letters, no numeric component for street addresses,
// and the common "city, state" only case (which is too coarse for routing).
export function validateAddress(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { valid: false, reason: 'empty' };
  if (s.length < 5) return { valid: false, reason: 'too short' };
  const hasLetters = /[a-zA-Z]/.test(s);
  const hasDigits = /\d/.test(s);
  if (!hasLetters) return { valid: false, reason: 'no letters' };
  if (!hasDigits) return { valid: false, reason: 'missing street number' };
  // Heuristic: should contain at least 3 tokens (number + name + something else).
  if (s.split(/\s+/).length < 3) return { valid: false, reason: 'incomplete address' };
  return { valid: true };
}
