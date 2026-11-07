import { POSITIONS, SHOW_NUMBERS, WEEK_DAYS, WEEK_LIMIT } from './config.js';
import { dayMinutes } from './hours.js';
import { addDays, dateRange, isoToNum } from './dates.js';
import { normalize } from './nameMatch.js';

// Combine saved schedules into one timeline. For a date covered by several
// schedules, the most recently uploaded one wins.
export function mergeSchedules(schedules) {
  const owner = new Map();
  const ordered = [...schedules].sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)));
  for (const schedule of ordered) {
    for (const date of dateRange(schedule.start, schedule.end)) owner.set(date, schedule);
  }
  const rowsByDate = new Map();
  for (const [date, schedule] of owner) {
    rowsByDate.set(date, schedule.rows.filter(r => r.date === date));
  }
  return { covered: new Set(owner.keys()), rowsByDate };
}

// The person's shifts by date. Each person counts once per show, whether
// they appear as leader, in a position, or both.
export function shiftsFor(rowsByDate, name) {
  const key = normalize(name);
  const byDate = new Map();
  if (!key) return byDate;
  for (const [date, rows] of rowsByDate) {
    const shifts = [];
    for (const row of rows) {
      const isLeader = normalize(row.leader) === key;
      const position = POSITIONS.find(p => normalize(row.positions[p] ?? '') === key) ?? null;
      if (!isLeader && !position) continue;
      const existing = shifts.find(s => s.show === row.show);
      if (existing) {
        existing.isLeader ||= isLeader;
        existing.position ||= position;
      } else {
        shifts.push({ date, show: row.show, position, isLeader });
      }
    }
    if (shifts.length) byDate.set(date, shifts.sort((a, b) => a.show - b.show));
  }
  return byDate;
}

// One entry per date from `from` to `to`. Dates inside a schedule are known
// (0 if not working); every other date is unknown (minutes: null), never 0.
export function dailyResults(shiftsByDate, covered, from, to) {
  return dateRange(from, to).map(date => {
    const known = covered.has(date);
    const shifts = shiftsByDate.get(date) ?? [];
    return {
      date,
      known,
      shifts,
      shows: shifts.map(s => s.show),
      minutes: known ? dayMinutes(shifts) : null,
    };
  });
}

// Every 7-day window that touches a known date, including the ones that
// start before the first date. Windows with unknown days are partial.
export function windows(days) {
  const byDate = new Map(days.map(d => [d.date, d]));
  const knownDates = days.filter(d => d.known).map(d => d.date);
  if (!knownDates.length) return [];
  const first = knownDates[0];
  const last = knownDates.at(-1);
  const out = [];
  for (const start of dateRange(addDays(first, -(WEEK_DAYS - 1)), last)) {
    const end = addDays(start, WEEK_DAYS - 1);
    let minutes = 0;
    let partial = false;
    let touchesKnown = false;
    for (const date of dateRange(start, end)) {
      const day = byDate.get(date);
      if (!day || !day.known) partial = true;
      else { minutes += day.minutes; touchesKnown = true; }
    }
    if (touchesKnown) out.push({ start, end, minutes, partial, over: minutes > WEEK_LIMIT });
  }
  return out;
}

function windowsContaining(date, wins) {
  const n = isoToNum(date);
  return wins.filter(w => isoToNum(w.start) <= n && n <= isoToNum(w.end));
}

function worstOf(wins) {
  return wins.reduce((a, b) => (b.minutes > a.minutes ? b : a));
}

// How many more minutes this day could take before some window passes 28h.
// Never negative: an over window shows 0 and is returned as `limitedBy`.
export function remaining(days, wins) {
  return days.filter(d => d.known).map(d => {
    const containing = windowsContaining(d.date, wins);
    const worst = worstOf(containing);
    return {
      date: d.date,
      minutes: Math.max(0, WEEK_LIMIT - worst.minutes),
      limitedBy: worst,
      partial: containing.some(w => w.partial),
    };
  });
}

// For each known day, try adding each show the person is not working.
// Safe side: assume they would lead the added show (+15 min for Shows 1 and 5).
export function suggestShows(days, wins) {
  const out = [];
  for (const day of days.filter(d => d.known)) {
    const containing = windowsContaining(day.date, wins);
    for (const show of SHOW_NUMBERS) {
      if (day.shows.includes(show)) continue;
      const next = [...day.shifts, { show, isLeader: true }];
      const addsMinutes = dayMinutes(next) - day.minutes;
      const blocking = containing.filter(w => w.minutes + addsMinutes > WEEK_LIMIT);
      out.push({
        date: day.date,
        show,
        addsMinutes,
        allowed: blocking.length === 0,
        blockedBy: blocking.length ? worstOf(blocking) : null,
      });
    }
  }
  return out;
}

// Everything the result screen needs, in one call.
export function analyze(schedules, name) {
  const { covered, rowsByDate } = mergeSchedules(schedules);
  if (!covered.size) return null;
  const shiftsByDate = shiftsFor(rowsByDate, name);
  const coveredDates = [...covered].sort();
  const from = addDays(coveredDates[0], -(WEEK_DAYS - 1));
  const to = addDays(coveredDates.at(-1), WEEK_DAYS - 1);
  const days = dailyResults(shiftsByDate, covered, from, to);
  const wins = windows(days);
  const overWindows = wins.filter(w => w.over);
  const fullWindows = wins.filter(w => !w.partial);
  return {
    name,
    first: coveredDates[0],
    last: coveredDates.at(-1),
    hasGaps: coveredDates.length !== dateRange(coveredDates[0], coveredDates.at(-1)).length,
    days: days.filter(d => d.known),
    windows: wins,
    overWindows,
    highest: wins.length ? worstOf(wins) : null,
    highestFull: fullWindows.length ? worstOf(fullWindows) : null,
    remaining: remaining(days, wins),
    suggestions: suggestShows(days, wins),
    totalShifts: [...shiftsByDate.values()].reduce((n, s) => n + s.length, 0),
  };
}
