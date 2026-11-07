import { POSITIONS } from './config.js';

const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}';
const SPACE_BETWEEN_CJK = new RegExp(`(?<=[${CJK}])\\s+(?=[${CJK}])`, 'gu');

// NFKC (full-width Ｎｉｃｏ → Nico), lowercase, remove spaces between Japanese
// characters (鈴木 花 → 鈴木花), collapse every other run of spaces.
export function normalize(name) {
  if (typeof name !== 'string') return '';
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(SPACE_BETWEEN_CJK, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sameName(a, b) {
  const na = normalize(a);
  return na !== '' && na === normalize(b);
}

// Every distinct name in the schedules (leader + position cells), as first written.
export function allNames(schedules) {
  const seen = new Map();
  const add = raw => {
    const key = normalize(raw);
    if (key && !seen.has(key)) seen.set(key, raw.trim());
  };
  for (const schedule of schedules) {
    for (const row of schedule.rows) {
      add(row.leader);
      for (const p of POSITIONS) add(row.positions[p] ?? '');
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// Exact match only: "Hina" never finds "Hinata", "Sean" never finds "Sean IRL".
export function findExact(input, names) {
  const key = normalize(input);
  if (!key) return null;
  return names.find(n => normalize(n) === key) ?? null;
}

// Suggestions while typing / "did you mean": names starting with the input first.
export function suggest(input, names, limit = 6) {
  const key = normalize(input);
  if (!key) return [];
  const starts = [];
  const contains = [];
  for (const n of names) {
    const nn = normalize(n);
    if (nn.startsWith(key)) starts.push(n);
    else if (nn.includes(key)) contains.push(n);
  }
  return [...starts, ...contains].slice(0, limit);
}
