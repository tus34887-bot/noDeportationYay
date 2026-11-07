// Turns positioned PDF text into a clean schedule: one row per show per day.
// Anything doubtful becomes a warning (shown on the Review step), never a silent drop.

import { POSITIONS, SHOWS } from './config.js';
import { groupLines, findColumns, columnMap } from './pdfParser.js';
import { makeIso, isoToNum, weekdayOf, shortDate, WEEKDAYS } from './dates.js';

const NAME_COLUMNS = ['Leader', ...POSITIONS];
const LEFT_COLUMNS = ['Date', 'Day'];
const EDGE = 3;  // an item must reach this far past a boundary to count as crossing it

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const isUpper = c => c !== c.toLowerCase() && c === c.toUpperCase();
const isLower = c => c !== c.toUpperCase() && c === c.toLowerCase();

// A good place to cut "BartholomeusSelena": a space, a lower→Upper change,
// or a change between Japanese and Latin script.
function isCutPoint(s, i) {
  const a = s[i - 1];
  const b = s[i];
  if (a === ' ' || b === ' ') return true;
  if (isLower(a) && isUpper(b)) return true;
  return CJK_CHAR.test(a) !== CJK_CHAR.test(b);
}

function snap(s, estimate) {
  let best = null;
  for (let i = 1; i < s.length; i++) {
    if (Math.abs(i - estimate) <= 2.5 && isCutPoint(s, i)) {
      if (best === null || Math.abs(i - estimate) < Math.abs(best - estimate)) best = i;
    }
  }
  return best;
}

// Split an item that runs across column boundaries (names that touch in the
// PDF come out as one piece of text). Returns { pieces } or { unresolved }.
export function splitItem(item, map) {
  const s = item.str;
  const crossing = map.bounds.filter(b => b > item.x + EDGE && b < item.x + item.width - EDGE);
  if (!crossing.length) return { pieces: [item] };

  const charW = item.width / s.length;
  const estimates = crossing.map(b => (b - item.x) / charW);
  const cuts = estimates.map(e => snap(s, e));

  const pieceAt = (from, to) => {
    const text = s.slice(from, to);
    const lead = text.length - text.trimStart().length;
    const trimmed = text.trim();
    return { ...item, str: trimmed, x: item.x + (from + lead) * charW, width: trimmed.length * charW };
  };

  if (cuts.every(c => c !== null) && new Set(cuts).size === cuts.length) {
    const points = [0, ...cuts.sort((a, b) => a - b), s.length];
    const pieces = points.slice(1).map((to, i) => pieceAt(points[i], to)).filter(p => p.str);
    return { pieces };
  }

  // No safe cut: keep the whole text for the user to fix, with a best guess per column.
  const guessPoints = [0, ...estimates.map(e => Math.min(s.length, Math.max(0, Math.round(e)))), s.length];
  const guesses = guessPoints.slice(1).map((to, i) => pieceAt(guessPoints[i], to));
  return {
    unresolved: {
      text: s,
      columns: guesses.map(g => map.nameAt(g.x + g.width / 2)),
      guess: guesses.map(g => g.str),
    },
  };
}

// Choose the year in which month/day falls on the printed weekday, closest to today.
export function pickYear(month, day, weekday, today) {
  const year = Number(today.slice(0, 4));
  const candidates = [year - 1, year, year + 1].map(y => makeIso(y, month, day));
  const matching = weekday ? candidates.filter(iso => weekdayOf(iso) === weekday) : candidates;
  const pool = matching.length ? matching : candidates;
  const t = isoToNum(today);
  const best = pool.reduce((a, b) => (Math.abs(isoToNum(b) - t) < Math.abs(isoToNum(a) - t) ? b : a));
  return { iso: best, weekdayMatched: !weekday || matching.length > 0 };
}

const toMinutes = (h, m) => Number(h) * 60 + Number(m);
const clock = min => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

// Step 1: lines of positioned text → raw rows (still with printed date text).
function collectRawRows(pages, warnings) {
  const rawRows = [];
  let map = null;
  let current = null;

  pages.forEach((items, pageIndex) => {
    const pageNo = pageIndex + 1;
    let lines = groupLines(items);
    const header = findColumns(lines);
    if (header) {
      lines = lines.filter(l => l.y < header.headerBottomY - 2.5);
      if (header.columns) {
        map = columnMap(header.columns, header.bounds);
        if (header.slotCount !== undefined && header.slotCount !== 9) {
          warnings.push(`Page ${pageNo}: found ${header.slotCount} name columns instead of 9 (Leader + A–I), so position letters may be off. Hours are not affected as long as the leader column is right.`);
        }
      }
    }
    if (!map) {
      if (lines.length) warnings.push(`Page ${pageNo}: no table header found, page skipped.`);
      return;
    }

    for (const line of lines) {
      const cells = {};
      const unresolved = [];
      for (const item of line.items) {
        const result = splitItem(item, map);
        if (result.unresolved) {
          if (result.unresolved.columns.some(c => NAME_COLUMNS.includes(c))) unresolved.push(result.unresolved);
          continue;
        }
        for (const piece of result.pieces) {
          const col = map.nameAt(piece.x + piece.width / 2);
          (cells[col] ??= []).push(piece.str.trim());
        }
      }

      const shiftText = (cells.Shift ?? []).join(' ');
      const anchor = /^Shift\s*(\d+)$/i.exec(shiftText.trim());
      if (anchor) {
        current = {
          page: pageNo,
          left: LEFT_COLUMNS.flatMap(c => cells[c] ?? []).join(' '),
          show: Number(anchor[1]),
          time: (cells.Time ?? []).join(' '),
          cells: Object.fromEntries(NAME_COLUMNS.map(c => [c, [...(cells[c] ?? [])]])),
          unresolved,
        };
        rawRows.push(current);
        continue;
      }

      // Not a new row: a wrapped name belongs to the row above.
      const extra = NAME_COLUMNS.flatMap(c => (cells[c] ?? []).map(t => [c, t]));
      if (!current) continue;
      for (const [c, t] of extra) current.cells[c].push(t);
      current.unresolved.push(...unresolved);
      const stray = LEFT_COLUMNS.flatMap(c => cells[c] ?? []).join(' ');
      if (stray) warnings.push(`Page ${pageNo}: text "${stray}" outside any row was ignored.`);
    }
  });
  return rawRows;
}

// Step 2: raw rows → dated, checked rows.
export function buildSchedule(pages, { today, fileName = '', uploadedAt = new Date().toISOString() } = {}) {
  if (!today) throw new Error('buildSchedule needs today (YYYY-MM-DD)');
  const warnings = [];
  const rawRows = collectRawRows(pages, warnings);

  const rows = [];
  const seen = new Set();
  const timeWarned = new Set();
  let prevDate = null;

  for (const raw of rawRows) {
    const label = `${raw.left || '(no date)'} Shift ${raw.show}`.trim();
    const dm = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(raw.left);
    const wdMatch = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.exec(raw.left);
    const weekday = wdMatch ? WEEKDAYS.find(w => w.toLowerCase() === wdMatch[1].toLowerCase()) : null;

    let date;
    if (dm) {
      const month = Number(dm[1]);
      const day = Number(dm[2]);
      if (!prevDate) {
        const picked = pickYear(month, day, weekday, today);
        date = picked.iso;
        if (!picked.weekdayMatched) warnings.push(`"${label}": ${month}/${day} is not a ${weekday} near this year — please check the dates.`);
      } else {
        let year = Number(prevDate.slice(0, 4));
        const prevMonth = Number(prevDate.slice(5, 7));
        if (prevMonth === 12 && month === 1) year += 1;
        date = makeIso(year, month, day);
        if (date < prevDate) {
          warnings.push(`Skipped row "${label}" on page ${raw.page}: its date comes before the rows above it.`);
          continue;
        }
      }
    } else {
      if (!prevDate) {
        warnings.push(`Skipped row "${label}" on page ${raw.page}: no date above it.`);
        continue;
      }
      date = prevDate;
    }

    if (weekday && weekdayOf(date) !== weekday) {
      warnings.push(`"${label}": ${shortDate(date)} is a ${weekdayOf(date)}, but the PDF says ${weekday}.`);
    }

    if (!Object.hasOwn(SHOWS, raw.show)) {
      warnings.push(`Skipped row "${label}": there is no Show ${raw.show}.`);
      continue;
    }

    const t = /(\d{1,2}):(\d{2})\s*[-–~]\s*(\d{1,2}):(\d{2})/.exec(raw.time);
    if (t && !timeWarned.has(raw.show)) {
      const start = toMinutes(t[1], t[2]);
      const end = toMinutes(t[3], t[4]);
      const cfg = SHOWS[raw.show];
      if (start !== cfg.start || end !== cfg.end) {
        timeWarned.add(raw.show);
        warnings.push(`Show ${raw.show} is printed as ${clock(start)}–${clock(end)}, but the app uses ${clock(cfg.start)}–${clock(cfg.end)}.`);
      }
    }

    const leader = raw.cells.Leader.join(' ').trim();
    const positions = Object.fromEntries(POSITIONS.map(p => [p, raw.cells[p].join(' ').trim()]));
    const hasNames = leader || POSITIONS.some(p => positions[p]) || raw.unresolved.length;
    prevDate = date;

    if (!hasNames) {
      warnings.push(`Skipped row "${label}" on page ${raw.page}: no names in it.`);
      continue;
    }

    const key = `${date}#${raw.show}`;
    if (seen.has(key)) {
      warnings.push(`Skipped a second row for ${shortDate(date)} Show ${raw.show} on page ${raw.page}.`);
      continue;
    }
    seen.add(key);

    rows.push({ date, show: raw.show, leader, positions, unresolved: raw.unresolved });
  }

  if (!rows.length) throw new Error('No schedule rows were found in this PDF. Is it the shift schedule?');

  const dates = rows.map(r => r.date).sort();
  const start = dates[0];
  const end = dates.at(-1);
  return {
    id: `${start}_${end}`,
    label: `${shortDate(start)}–${shortDate(end)}`,
    start,
    end,
    fileName,
    uploadedAt,
    rows,
    warnings,
  };
}

export function unresolvedCount(schedule) {
  return schedule.rows.reduce((n, r) => n + r.unresolved.length, 0);
}

// The user typed the correct names for a merged cell on the Review step.
export function applyFix(schedule, rowIndex, fixIndex, values) {
  const row = schedule.rows[rowIndex];
  const fix = row.unresolved[fixIndex];
  fix.columns.forEach((col, i) => {
    const value = (values[i] ?? '').trim();
    if (!value) return;
    if (col === 'Leader') row.leader = row.leader ? `${row.leader} ${value}` : value;
    else if (POSITIONS.includes(col)) row.positions[col] = row.positions[col] ? `${row.positions[col]} ${value}` : value;
  });
  row.unresolved.splice(fixIndex, 1);
  return schedule;
}
