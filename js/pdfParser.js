// Turns the PDF into positioned text and table columns.
// Only extractPages() touches pdf.js (passed in, so tests can run in Node);
// everything else is plain data in, data out.

import { POSITIONS } from './config.js';

const LINE_TOLERANCE = 2.5;   // items within this many points of y are one line
const HEADER_REACH = 8;       // "Leader" may sit a little above the A–I header line

export async function extractPages(pdfjsLib, data) {
  const task = pdfjsLib.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .filter(it => typeof it.str === 'string' && it.str.trim() !== '')
          .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, page: p })),
      );
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

// Group one page's items into lines, top to bottom. pdf.js measures y from
// the bottom of the page, so top-to-bottom means y descending.
export function groupLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - item.y) <= LINE_TOLERANCE) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

const center = it => it.x + it.width / 2;

const HEADER_WORDS = ['Date', 'Day', 'Shift', 'Time', 'Break', 'Leader'];
const SLOT_NAMES = ['Leader', ...POSITIONS];   // 9 name slots per row, left to right
const SHOW_CELL = /^Shift\s*\d+$/i;

// Find the header and turn it into columns. Two layouts are supported:
//  - with A–I letters in the header: columns come from the letters;
//  - without letters: the 9 name slots (Leader + 8 positions) are found from
//    where names start in the rows, and labelled Leader, A … G, I in order.
// Returns null when the page has no header at all.
export function findColumns(lines) {
  // The header is the line with a bare "Shift" (data rows say "Shift 1").
  const headerLine = lines.find(l => l.items.some(it => it.str.trim() === 'Shift'));
  if (!headerLine) return null;

  // Header text can sit on the "Shift" line or a little above it ("Leader" in the
  // older layout). A line holding a "Shift N" cell is a data row, never header.
  const headerLines = lines.filter(l => l.y >= headerLine.y - LINE_TOLERANCE && l.y <= headerLine.y + HEADER_REACH
    && !l.items.some(it => SHOW_CELL.test(it.str.trim())));
  const headerItems = headerLines.flatMap(l => l.items);
  const headerBottomY = Math.min(...headerLines.map(l => l.y));

  const named = new Map();
  for (const it of headerItems) {
    const s = it.str.trim();
    if (POSITIONS.includes(s) || HEADER_WORDS.includes(s)) named.set(s, center(it));
  }
  if (!named.has('Leader')) {
    // "Leader" merged with a name ("EmmaLeader"): take the centre of its last 6 letters.
    const near = headerItems.find(it => it.str.trim().endsWith('Leader'));
    if (near) {
      const s = near.str.trim();
      const charW = near.width / s.length;
      const leaderStart = near.x + charW * (s.length - 'Leader'.length);
      named.set('Leader', leaderStart + charW * 'Leader'.length / 2);
    }
  }
  if (!named.has('Leader')) return null;

  const letters = POSITIONS.filter(p => named.has(p));
  if (letters.length >= 5) {
    const columns = [...named].map(([name, c]) => ({ name, center: c })).sort((a, b) => a.center - b.center);
    return { columns, headerBottomY, layout: 'letters' };
  }

  // No letters: find the name slots from the data rows below the header.
  const rows = lines.filter(l => l.y < headerBottomY - LINE_TOLERANCE && l.items.some(it => SHOW_CELL.test(it.str.trim())));
  const inferred = inferSlots(rows, named);
  if (!inferred) return { columns: null, headerBottomY, layout: 'slots' };
  return { ...inferred, headerBottomY, layout: 'slots' };
}

// Group the left edges of names into 9 slots by cutting at the 8 widest gaps.
function inferSlots(rows, named) {
  const leaderC = named.get('Leader');
  const timeC = named.get('Time') ?? named.get('Shift');
  const lo = (timeC + leaderC) / 2;
  const hi = named.has('Break') ? named.get('Break') - 8 : Infinity;

  const starts = [...new Set(rows.flatMap(l => l.items)
    .filter(it => it.x >= lo && it.x < hi)
    .map(it => Math.round(it.x * 10) / 10))].sort((a, b) => a - b);
  if (starts.length < 2) return null;

  const gaps = starts.slice(1).map((x, i) => ({ at: i, size: x - starts[i] }));
  const cuts = [...gaps].sort((a, b) => b.size - a.size).slice(0, SLOT_NAMES.length - 1).map(g => g.at).sort((a, b) => a - b);
  const groups = [];
  let from = 0;
  for (const at of [...cuts, starts.length - 1]) {
    groups.push(starts.slice(from, at + 1));
    from = at + 1;
  }

  // Columns: left of Leader from the header, then the slots, then Break.
  const left = [...named].filter(([n, c]) => c < lo && n !== 'Leader').map(([name, c]) => ({ name, center: c })).sort((a, b) => a.center - b.center);
  const slots = groups.map((g, i) => ({ name: SLOT_NAMES[i], center: (g[0] + g.at(-1)) / 2 }));
  const columns = [...left, ...slots];
  if (named.has('Break')) columns.push({ name: 'Break', center: named.get('Break') });

  // A slot begins just before its first name; names are left-aligned in their cells.
  const bounds = [];
  for (let i = 1; i < left.length; i++) bounds.push((left[i - 1].center + left[i].center) / 2);
  if (left.length) bounds.push(lo);
  for (let i = 1; i < groups.length; i++) bounds.push(groups[i][0] - 1.5);
  if (named.has('Break')) bounds.push(hi);

  return { columns, bounds, slotCount: groups.length };
}

// Column lookup by x position. Bounds default to midpoints between column centres.
export function columnMap(columns, explicitBounds) {
  const bounds = explicitBounds ?? columns.slice(1).map((c, i) => (columns[i].center + c.center) / 2);
  const indexAt = x => {
    let i = 0;
    while (i < bounds.length && x >= bounds[i]) i++;
    return i;
  };
  return {
    columns,
    bounds,
    nameAt: x => columns[indexAt(x)].name,
  };
}
