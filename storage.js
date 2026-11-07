// Saves parsed schedules (not the PDF) in this browser's localStorage.
// Every function that touches storage takes it as an argument so tests can pass a fake.

import { STORAGE_KEY, STORAGE_VERSION, SHOW_NUMBERS, POSITIONS } from './config.js';
import { isValidIso } from './dates.js';

export const emptyState = () => ({ version: STORAGE_VERSION, name: '', schedules: [] });

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function load(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return validateState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

// Returns false when the browser refuses (private mode, storage full): the app keeps working unsaved.
export function save(state, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export async function askToPersist() {
  try { return await globalThis.navigator?.storage?.persist?.() ?? false; } catch { return false; }
}

const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;

// Same date range = same schedule: re-uploading replaces it instead of adding a copy.
export function addSchedule(state, schedule) {
  const replaced = state.schedules.some(s => s.id === schedule.id);
  const others = state.schedules.filter(s => s.id !== schedule.id);
  const overlapping = others.filter(s => overlaps(s, schedule)).map(s => s.label);
  return {
    state: { ...state, schedules: [...others, schedule].sort((a, b) => a.start.localeCompare(b.start)) },
    replaced,
    overlapping,
  };
}

export function deleteSchedule(state, id) {
  return { ...state, schedules: state.schedules.filter(s => s.id !== id) };
}

export function clearAll() {
  return emptyState();
}

export function exportJSON(state) {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not a backup from this app.'); }
  return validateState(data);
}

const isStr = v => typeof v === 'string';

function validRow(r) {
  return r && isValidIso(r.date) && SHOW_NUMBERS.includes(r.show) && isStr(r.leader)
    && r.positions && typeof r.positions === 'object'
    && POSITIONS.every(p => r.positions[p] === undefined || isStr(r.positions[p]))
    && (r.unresolved === undefined || Array.isArray(r.unresolved));
}

function validSchedule(s) {
  return s && isStr(s.id) && isStr(s.label) && isValidIso(s.start) && isValidIso(s.end)
    && s.start <= s.end && Array.isArray(s.rows) && s.rows.every(validRow)
    && (s.warnings === undefined || (Array.isArray(s.warnings) && s.warnings.every(isStr)));
}

// Checks shape before anything from storage or an imported file is trusted.
export function validateState(data) {
  if (!data || data.version !== STORAGE_VERSION) throw new Error('This backup is from a different version of the app.');
  if (!Array.isArray(data.schedules) || !data.schedules.every(validSchedule)) throw new Error('This backup file is damaged.');
  return {
    version: STORAGE_VERSION,
    name: isStr(data.name) ? data.name : '',
    schedules: data.schedules.map(s => ({
      id: s.id, label: s.label, start: s.start, end: s.end,
      fileName: isStr(s.fileName) ? s.fileName : '',
      uploadedAt: isStr(s.uploadedAt) ? s.uploadedAt : '',
      warnings: s.warnings ?? [],
      rows: s.rows.map(r => ({
        date: r.date, show: r.show, leader: r.leader,
        positions: Object.fromEntries(POSITIONS.map(p => [p, r.positions[p] ?? ''])),
        unresolved: r.unresolved ?? [],
      })),
    })),
  };
}
