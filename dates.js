// Date helpers on ISO strings ('2026-11-09'), all in UTC so time zones never shift a day.

const DAY_MS = 86400000;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isoToNum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function numToIso(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  return numToIso(isoToNum(iso) + days);
}

export function makeIso(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isValidIso(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return numToIso(isoToNum(iso)) === iso;
}

export function weekdayOf(iso) {
  return WEEKDAYS[new Date(isoToNum(iso) * DAY_MS).getUTCDay()];
}

// "11/9"
export function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

// Every ISO date from `from` to `to`, inclusive.
export function dateRange(from, to) {
  const out = [];
  for (let n = isoToNum(from), end = isoToNum(to); n <= end; n++) out.push(numToIso(n));
  return out;
}

// Minutes → "7h 30m", "6h", "45m"
export function formatMinutes(min) {
  const sign = min < 0 ? '−' : '';
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h && m) return `${sign}${h}h ${m}m`;
  if (h) return `${sign}${h}h`;
  return `${sign}${m}m`;
}
