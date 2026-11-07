import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, mergeSchedules, shiftsFor } from '../js/checker.js';
import { dateRange } from '../js/dates.js';

// Build a schedule where `name` works the given shows on given dates.
// plan: { '2026-11-09': [1, 2], ... }   leaderPlan: same shape, shows led.
function schedule({ start, end, name = 'Pat', plan = {}, leaderPlan = {}, uploadedAt = '2026-11-01T00:00:00Z' }) {
  const rows = [];
  for (const date of dateRange(start, end)) {
    for (const show of [1, 2, 3, 4, 5]) {
      const works = (plan[date] ?? []).includes(show);
      const leads = (leaderPlan[date] ?? []).includes(show);
      rows.push({
        date, show,
        leader: leads ? name : 'Other',
        positions: { A: works ? name : 'Someone', B: '', C: '', D: '', E: '', F: '', G: '', I: '' },
      });
    }
  }
  return { id: `${start}_${end}`, start, end, uploadedAt, rows };
}

const W = '2026-11-09'; // a Monday

test('exactly 28h in a window is OK, one minute more is over', () => {
  // 3 shows from Show 1 = 435 min. 435*3 = 1305; need 375 more → [1,2]=330 + ... use exact build:
  // 1680 = 450 (lead 1-3) *2 + 330*2 + 120? Not reachable with shows, so test via windows of known values:
  // Four days of [1,2,3,4] = 570*4 = 2280 (over). Two days of [1,2,3,4] + two of [1,2] = 1140+660 = 1800 (over).
  // Exactly 1680: 570 + 570 + 360(lead 4,5) + 180 = 1680.
  const s = schedule({
    start: W, end: '2026-11-15',
    plan: { '2026-11-09': [1, 2, 3, 4], '2026-11-10': [1, 2, 3, 4], '2026-11-11': [4, 5], '2026-11-12': [2] },
    leaderPlan: { '2026-11-11': [4, 5] },
  });
  const r = analyze([s], 'Pat');
  const full = r.windows.find(w => w.start === W);
  assert.equal(full.minutes, 1680);
  assert.equal(full.over, false);
  assert.equal(r.overWindows.length, 0);

  // Add one more Show 2 on 11/13 → over.
  const s2 = schedule({
    start: W, end: '2026-11-15',
    plan: { '2026-11-09': [1, 2, 3, 4], '2026-11-10': [1, 2, 3, 4], '2026-11-11': [4, 5], '2026-11-12': [2], '2026-11-13': [3] },
    leaderPlan: { '2026-11-11': [4, 5] },
  });
  const r2 = analyze([s2], 'Pat');
  assert.equal(r2.windows.find(w => w.start === W).minutes, 1860);
  assert.ok(r2.overWindows.length > 0);
});

test('windows start 6 days before the first date and are partial', () => {
  const r = analyze([schedule({ start: W, end: '2026-11-22', plan: { [W]: [1] } })], 'Pat');
  const firstWindow = r.windows[0];
  assert.equal(firstWindow.start, '2026-11-03');
  assert.equal(firstWindow.end, W);
  assert.equal(firstWindow.partial, true);
  assert.equal(firstWindow.minutes, 180);
  const fullOne = r.windows.find(w => w.start === W);
  assert.equal(fullOne.partial, false);
});

test('a gap between two schedules is unknown, not 0', () => {
  const a = schedule({ start: W, end: '2026-11-22', plan: { '2026-11-22': [1, 2, 3, 4] } });
  const b = schedule({ start: '2026-12-07', end: '2026-12-20', plan: {} });
  const r = analyze([a, b], 'Pat');
  assert.equal(r.hasGaps, true);
  const crossing = r.windows.find(w => w.start === '2026-11-20');
  assert.equal(crossing.partial, true);
  assert.ok(!r.days.some(d => d.date === '2026-11-30'), 'gap days are not listed as known');
  const gapWindow = r.windows.find(w => w.start === '2026-11-25');
  assert.equal(gapWindow, undefined, 'a window with no known day is not listed');
});

test('remaining is never negative and points at the over window', () => {
  const plan = {};
  for (const d of dateRange(W, '2026-11-12')) plan[d] = [1, 2, 3, 4]; // 4 × 570 = 2280
  const r = analyze([schedule({ start: W, end: '2026-11-22', plan })], 'Pat');
  const day = r.remaining.find(x => x.date === W);
  assert.equal(day.minutes, 0);
  assert.equal(day.limitedBy.over, true);
  assert.ok(r.remaining.every(x => x.minutes >= 0));
});

test('remaining for a quiet week is 28h minus the worst window', () => {
  const r = analyze([schedule({ start: W, end: '2026-11-22', plan: { '2026-11-12': [1, 2] } })], 'Pat');
  const d = r.remaining.find(x => x.date === '2026-11-12');
  assert.equal(d.minutes, 1680 - 330);
});

test('suggestions include the leader extra and block over-limit shows', () => {
  const plan = { [W]: [1, 2, 3, 4], '2026-11-10': [1, 2, 3, 4], '2026-11-11': [1, 2] }; // 570+570+330 = 1470
  const r = analyze([schedule({ start: W, end: '2026-11-22', plan })], 'Pat');
  const on12 = r.suggestions.filter(x => x.date === '2026-11-12');
  const show1 = on12.find(x => x.show === 1);
  assert.equal(show1.addsMinutes, 195); // 180 + 15 as leader of Show 1
  assert.equal(show1.allowed, true);    // 1470 + 195 = 1665 ≤ 1680
  const show5 = on12.find(x => x.show === 5);
  assert.equal(show5.addsMinutes, 210); // 195 + 15 as leader of Show 5

  // One more show elsewhere in the week (1470 + 180 = 1650) → Show 1 on 11/12 no longer fits.
  const busier = analyze([schedule({ start: W, end: '2026-11-22', plan: { ...plan, '2026-11-14': [3] } })], 'Pat');
  const blocked = busier.suggestions.find(x => x.date === '2026-11-12' && x.show === 1);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.blockedBy.minutes, 1650);
});

test('suggestion exactly reaching 28h is allowed', () => {
  // 1470 + 210 = 1680 → allowed
  const plan = { [W]: [1, 2, 3, 4], '2026-11-10': [1, 2, 3, 4], '2026-11-11': [1, 2] };
  const r = analyze([schedule({ start: W, end: '2026-11-22', plan })], 'Pat');
  const show5 = r.suggestions.find(x => x.date === '2026-11-12' && x.show === 5);
  assert.equal(show5.allowed, true);
  // Adding a 3rd show next to [1,2] on 11/11 changes the break: [1,2,3] = 435 - 330 = +105, leader of 3 adds nothing
  const add3 = r.suggestions.find(x => x.date === '2026-11-11' && x.show === 3);
  assert.equal(add3.addsMinutes, 105);
});

test('Nico-style split day: adding the middle show adds nothing', () => {
  const r = analyze([schedule({ start: W, end: '2026-11-15', plan: { [W]: [1, 2, 4, 5] } })], 'Pat');
  const add3 = r.suggestions.find(x => x.date === W && x.show === 3);
  assert.equal(r.days.find(d => d.date === W).minutes, 615);
  assert.equal(add3.addsMinutes, 0);
});

test('leader cell in different case still counts as leader', () => {
  const s = schedule({ start: W, end: W, plan: { [W]: [1] } });
  s.rows[0].leader = 'PAT';
  const { rowsByDate } = mergeSchedules([s]);
  const shifts = shiftsFor(rowsByDate, 'pat').get(W);
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].isLeader, true);
});

test('leader listed in a position too counts once per show', () => {
  const s = schedule({ start: W, end: W, plan: { [W]: [1, 2, 3] }, leaderPlan: { [W]: [1, 2, 3] } });
  const r = analyze([s], 'Pat');
  assert.equal(r.days[0].minutes, 450); // Ada on 11/9
});

test('newer upload wins for overlapping dates', () => {
  const old = schedule({ start: W, end: '2026-11-15', plan: { [W]: [1] }, uploadedAt: '2026-11-01T00:00:00Z' });
  const neu = schedule({ start: W, end: '2026-11-15', plan: { [W]: [1, 2] }, uploadedAt: '2026-11-05T00:00:00Z' });
  assert.equal(analyze([neu, old], 'Pat').days[0].minutes, 330);
});

test('no schedules → null', () => {
  assert.equal(analyze([], 'Pat'), null);
});
