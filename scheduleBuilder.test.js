import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSchedule, splitItem, pickYear, applyFix, unresolvedCount } from '../js/scheduleBuilder.js';
import { groupLines, findColumns, columnMap } from '../js/pdfParser.js';
import { analyze } from '../js/checker.js';

// Text positions extracted once from the real 11/9–11/22 PDF (pages 1–3),
// with every real name replaced by a fake one of the same length.
const pages = JSON.parse(fs.readFileSync(new URL('./fixtures/schedule-1109.json', import.meta.url)));
const TODAY = '2026-11-07';

test('real layout: 14 days × 5 shows, one stray row skipped', () => {
  const s = buildSchedule(pages, { today: TODAY });
  assert.equal(s.id, '2026-11-09_2026-11-22');
  assert.equal(s.label, '11/9–11/22');
  assert.equal(s.rows.length, 70);
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /11\/12 Thu Shift 1/);
  assert.equal(unresolvedCount(s), 0);
});

test('real layout: dates carry forward, across the page break too', () => {
  const s = buildSchedule(pages, { today: TODAY });
  const shows = d => s.rows.filter(r => r.date === d).map(r => r.show);
  assert.deepEqual(shows('2026-11-09'), [1, 2, 3, 4, 5]);
  assert.deepEqual(shows('2026-11-16'), [1, 2, 3, 4, 5]); // Show 5 is the first row on page 2
  assert.deepEqual(shows('2026-11-19'), [1, 2, 3, 4, 5]); // right after the stray row
});

test('real layout: worked examples on 11/9', () => {
  const s = buildSchedule(pages, { today: TODAY });
  const minutes = name => analyze([s], name).days.find(d => d.date === '2026-11-09').minutes;
  assert.equal(minutes('Ada'), 450);  // leads 1–3, also in column I
  assert.equal(minutes('Miko'), 360); // leads 4–5
  assert.equal(minutes('Nico'), 615); // 1, 2, 4, 5
});

test('real layout: names that touch in the PDF are split into their columns', () => {
  const s = buildSchedule(pages, { today: TODAY });
  const row = s.rows.find(r => r.date === '2026-11-14' && r.show === 1);
  assert.equal(row.positions.E, 'Bartholomeus');
  assert.equal(row.positions.F, 'Tama');
  const row2 = s.rows.find(r => r.date === '2026-11-11' && r.show === 4);
  assert.equal(row2.positions.D, 'Bartholomeus');
  assert.equal(row2.positions.E, 'Bianca');
});

test('real layout: empty leader cell and the Break column', () => {
  const s = buildSchedule(pages, { today: TODAY });
  const noLeader = s.rows.find(r => r.date === '2026-11-14' && r.show === 2);
  assert.equal(noLeader.leader, '');
  assert.equal(noLeader.positions.A, 'Vikrant');
  // A name in the Break column (11/17 Show 3) is ignored.
  const withBreak = s.rows.find(r => r.date === '2026-11-17' && r.show === 3);
  const all = [withBreak.leader, ...Object.values(withBreak.positions)];
  assert.ok(!all.some(n => /Aiko/.test(n)));
  assert.equal(all.filter(n => n === '鈴木花').length, 0);
});

// ---- Synthetic layouts for cases the real PDF doesn't contain ----

const HEADER = [
  ['Leader', 159, 548, 16.6], ['Date', 57, 544, 11.6], ['Day', 79, 544, 9.4], ['Shift', 96, 544, 11.3],
  ['Time', 124, 544, 12.1], ['A', 200.5, 544, 3.6], ['B', 234, 544, 3.3], ['C', 267.8, 544, 3.1],
  ['D', 300.8, 544, 3.7], ['E', 334.6, 544, 2.9], ['F', 368, 544, 2.7], ['G', 401, 544, 3.8],
  ['I', 435.7, 544, 1.6], ['Break', 462.5, 544, 14.1],
];
const item = (str, x, y, width = str.length * 2.7) => ({ str, x, y, width });
const header = () => HEADER.map(([s, x, y, w]) => item(s, x, y, w));
const row = (y, { date = '', show, time = '8:45 - 11:45', leader = '', A = '', B = '' }) => [
  date && item(date, 61, y, 25),
  item(`Shift ${show}`, 93, y, 15.2),
  item(time, 113, y, 28.5),
  leader && item(leader, 151, y),
  A && item(A, 188, y),
  B && item(B, 221, y),
].filter(Boolean);

test('a page with no header reuses the previous page columns', () => {
  const s = buildSchedule([
    [...header(), ...row(531, { date: '11/9 Mon', show: 1, A: 'Pat' })],
    [...row(531, { show: 2, time: '11:15 - 14:15', A: 'Pat' })],
  ], { today: TODAY });
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[1].date, '2026-11-09');
  assert.equal(s.rows[1].positions.A, 'Pat');
});

test('"Leader" merged with a name in the header is still found', () => {
  const merged = header().filter(it => it.str !== 'Leader');
  merged.push(item('EmmaLeader', 147.8, 548, 27.7)); // "Leader" part centred near 167
  const lines = groupLines(merged);
  const found = findColumns(lines);
  assert.ok(found);
  const leader = found.columns.find(c => c.name === 'Leader');
  assert.ok(Math.abs(leader.center - 167.3) < 1.5);
});

test('a wrapped name continues the row above instead of making a new row', () => {
  const s = buildSchedule([[
    ...header(),
    ...row(531, { date: '11/9 Mon', show: 1, A: 'Mary' }),
    item('Ann', 188, 524), // second line of a wrapped name, no "Shift N"
    ...row(518, { show: 2, time: '11:15 - 14:15', A: 'Pat' }),
  ]], { today: TODAY });
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[0].positions.A, 'Mary Ann');
});

test('a merged cell with no safe cut is kept and flagged, never dropped', () => {
  const s = buildSchedule([[
    ...header(),
    ...row(531, { date: '11/9 Mon', show: 1 }),
    item('aaaaaaaaaaaaaaaaaa', 221, 531, 48.6), // B into C, all lowercase: no cut point
  ]], { today: TODAY });
  assert.equal(unresolvedCount(s), 1);
  const fix = s.rows[0].unresolved[0];
  assert.deepEqual(fix.columns, ['B', 'C']);
  applyFix(s, 0, 0, ['Kim', 'Lee']);
  assert.equal(s.rows[0].positions.B, 'Kim');
  assert.equal(s.rows[0].positions.C, 'Lee');
  assert.equal(unresolvedCount(s), 0);
});

test('splitItem cuts at a capital letter or a space near the boundary', () => {
  const map = columnMap(findColumns(groupLines(header())).columns);
  const a = splitItem(item('BartholomeusSelena', 220.8, 0, 48.7), map);
  assert.deepEqual(a.pieces.map(p => p.str), ['Bartholomeus', 'Selena']);
  const b = splitItem(item('Bartholomeus Bianca', 287.6, 0, 51.7), map);
  assert.deepEqual(b.pieces.map(p => p.str), ['Bartholomeus', 'Bianca']);
  const c = splitItem(item('Bartholomeus', 287.6, 0, 33.5), map); // just touches the next column
  assert.deepEqual(c.pieces.map(p => p.str), ['Bartholomeus']);
});

test('year comes from the printed weekday', () => {
  assert.equal(pickYear(11, 9, 'Mon', '2026-11-07').iso, '2026-11-09');
  assert.equal(pickYear(1, 4, 'Mon', '2026-12-20').iso, '2027-01-04');
  assert.equal(pickYear(12, 28, 'Mon', '2027-01-03').iso, '2026-12-28');
  assert.equal(pickYear(11, 9, 'Fri', '2026-11-07').weekdayMatched, false); // no nearby year fits
});

test('a weekday that does not match the date warns', () => {
  const s = buildSchedule([[...header(), ...row(531, { date: '11/9 Mon', show: 1, A: 'Pat' }), ...row(518, { date: '11/10 Mon', show: 1, A: 'Pat' })]], { today: TODAY });
  assert.ok(s.warnings.some(w => /PDF says Mon/.test(w) || /not a Mon/.test(w)));
});

test('a printed time that differs from the config warns once', () => {
  const s = buildSchedule([[
    ...header(),
    ...row(531, { date: '11/9 Mon', show: 1, time: '9:00 - 12:00', A: 'Pat' }),
    ...row(518, { date: '11/10 Tue', show: 1, time: '9:00 - 12:00', A: 'Pat' }),
  ]], { today: TODAY });
  assert.equal(s.warnings.filter(w => /Show 1 is printed as 9:00–12:00/.test(w)).length, 1);
});

test('December to January rolls the year', () => {
  const s = buildSchedule([[
    ...header(),
    ...row(531, { date: '12/31 Thu', show: 1, A: 'Pat' }),
    ...row(518, { date: '1/1 Fri', show: 1, A: 'Pat' }),
  ]], { today: '2026-12-20' });
  assert.deepEqual(s.rows.map(r => r.date), ['2026-12-31', '2027-01-01']);
  assert.equal(s.warnings.length, 0);
});

test('a PDF with no rows is rejected', () => {
  assert.throws(() => buildSchedule([[...header()]], { today: TODAY }), /No schedule rows/);
});

// ---- Layout without A–I letters in the header (10/26–11/8 schedule, fake names) ----

const pagesNoLetters = JSON.parse(fs.readFileSync(new URL('./fixtures/schedule-1026-noletters.json', import.meta.url)));

test('no-letters layout: name slots are found from the rows', () => {
  const s = buildSchedule(pagesNoLetters, { today: '2026-11-08' });
  assert.equal(s.id, '2026-10-26_2026-11-08');
  assert.equal(s.rows.length, 70);
  assert.equal(s.warnings.length, 1); // the stray 9/21 row
  assert.match(s.warnings[0], /9\/21 Mon/);
});

test('no-letters layout: slots map to Leader, A … G, I in order', () => {
  const s = buildSchedule(pagesNoLetters, { today: '2026-11-08' });
  const r1 = s.rows.find(r => r.date === '2026-10-26' && r.show === 1);
  assert.equal(r1.leader, 'Ada');
  assert.deepEqual(r1.positions, { A: 'Amara', B: 'Bartholomeus', C: 'Sean IRL', D: 'Odette', E: 'Kenta', F: 'Selena', G: '', I: 'Ada' });
  const r5 = s.rows.find(r => r.date === '2026-10-26' && r.show === 5);
  assert.equal(r5.positions.A, '');      // empty first slot stays empty
  assert.equal(r5.positions.B, 'Amara');
  assert.equal(r5.positions.G, 'Henri'); // 7th slot even with gaps before it
  assert.equal(r5.positions.I, 'Miko');  // centred names in the last slot
});

test('no-letters layout: hours on 10/26', () => {
  const s = buildSchedule(pagesNoLetters, { today: '2026-11-08' });
  const minutes = name => analyze([s], name).days.find(d => d.date === '2026-10-26').minutes;
  assert.equal(minutes('Ada'), 450);    // leads 1–2, works 3
  assert.equal(minutes('Miko'), 360);   // leads 4–5
  assert.equal(minutes('Odette'), 435); // 1–3, not leading
});

test('both layouts together: windows run across the two schedules', () => {
  const a = buildSchedule(pagesNoLetters, { today: '2026-11-08', uploadedAt: '2026-11-01T00:00:00Z' });
  const b = buildSchedule(pages, { today: '2026-11-08', uploadedAt: '2026-11-08T00:00:00Z' });
  const r = analyze([a, b], 'Ada');
  assert.equal(r.first, '2026-10-26');
  assert.equal(r.last, '2026-11-22');
  assert.equal(r.hasGaps, false);
  const crossing = r.windows.find(w => w.start === '2026-11-05');
  assert.equal(crossing.partial, false);
});
