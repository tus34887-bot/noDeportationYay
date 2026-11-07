import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, save, addSchedule, deleteSchedule, exportJSON, importJSON, emptyState } from '../js/storage.js';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
const sched = (start, end, uploadedAt = '2026-11-07T00:00:00Z') => ({
  id: `${start}_${end}`, label: `${start}–${end}`, start, end, fileName: 'a.pdf', uploadedAt, warnings: [],
  rows: [{ date: start, show: 1, leader: 'Pat', positions: { A: 'Pat', B: '', C: '', D: '', E: '', F: '', G: '', I: '' }, unresolved: [] }],
});

test('save then load round-trips', () => {
  const st = fakeStorage();
  const state = { ...emptyState(), name: 'Pat', schedules: [sched('2026-11-09', '2026-11-22')] };
  assert.equal(save(state, st), true);
  assert.deepEqual(load(st), state);
});

test('load falls back to empty on missing or broken data', () => {
  assert.deepEqual(load(fakeStorage()), emptyState());
  const st = fakeStorage();
  st.setItem('h28:v1', '{not json');
  assert.deepEqual(load(st), emptyState());
  assert.deepEqual(load(null), emptyState());
});

test('save returns false when the browser refuses', () => {
  assert.equal(save(emptyState(), { setItem() { throw new Error('quota'); } }), false);
});

test('re-uploading the same date range replaces instead of duplicating', () => {
  let { state } = addSchedule(emptyState(), sched('2026-11-09', '2026-11-22'));
  const again = addSchedule(state, sched('2026-11-09', '2026-11-22', '2026-11-08T00:00:00Z'));
  assert.equal(again.replaced, true);
  assert.equal(again.state.schedules.length, 1);
  assert.equal(again.state.schedules[0].uploadedAt, '2026-11-08T00:00:00Z');
});

test('overlapping date ranges are reported', () => {
  const { state } = addSchedule(emptyState(), sched('2026-11-09', '2026-11-22'));
  const r = addSchedule(state, sched('2026-11-16', '2026-11-29'));
  assert.deepEqual(r.overlapping, ['2026-11-09–2026-11-22']);
  assert.equal(r.state.schedules.length, 2);
});

test('delete removes only that schedule', () => {
  let { state } = addSchedule(emptyState(), sched('2026-11-09', '2026-11-22'));
  ({ state } = addSchedule(state, sched('2026-11-23', '2026-12-06')));
  const after = deleteSchedule(state, '2026-11-09_2026-11-22');
  assert.deepEqual(after.schedules.map(s => s.id), ['2026-11-23_2026-12-06']);
});

test('import checks version and shape first', () => {
  const good = { ...emptyState(), schedules: [sched('2026-11-09', '2026-11-22')] };
  assert.deepEqual(importJSON(exportJSON(good)), good);
  assert.throws(() => importJSON('hello'), /not a backup/);
  assert.throws(() => importJSON(JSON.stringify({ ...good, version: 2 })), /different version/);
  const bad = structuredClone(good);
  bad.schedules[0].rows[0].show = 9;
  assert.throws(() => importJSON(JSON.stringify(bad)), /damaged/);
  const badDate = structuredClone(good);
  badDate.schedules[0].start = '2026-02-30';
  assert.throws(() => importJSON(JSON.stringify(badDate)), /damaged/);
});
