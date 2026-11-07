// Builds the page from data. No calculations here, and every name from the PDF
// is set as text (textContent), never as HTML.

import { SHOW_NUMBERS, WEEK_LIMIT } from './config.js';
import { formatMinutes, shortDate, weekdayOf } from './dates.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'hidden') el.hidden = Boolean(v);
    else if (k === 'style') Object.assign(el.style, v); // CSSOM, allowed by the page's CSP
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Like replaceChildren, but skips null/false (replaceChildren would print "null").
function setChildren(container, ...children) {
  container.replaceChildren(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
}

const range = w => `${shortDate(w.start)}–${shortDate(w.end)}`;

export function renderSchedules(container, schedules, { onDelete }) {
  if (!schedules.length) {
    container.replaceChildren(h('p', { class: 'quiet' }, 'No schedule yet. Add the PDF your workplace sends out.'));
    return;
  }
  container.replaceChildren(
    h('ul', { class: 'schedule-list' },
      schedules.map(s => h('li', { class: 'schedule-item' },
        h('div', { class: 'what' },
          h('strong', {}, s.label),
          h('span', { class: 'file' }, s.fileName || 'Schedule'),
        ),
        h('button', {
          type: 'button', class: 'button small', 'aria-label': `Remove schedule ${s.label}`,
          onclick: () => onDelete(s),
        }, 'Remove'),
      )),
    ),
  );
}

export function renderNameOptions(datalist, names) {
  datalist.replaceChildren(...names.map(n => h('option', { value: n })));
}

export function renderNameHelp(container, { input, suggestions }, { onPick }) {
  if (!input) { container.replaceChildren(); return; }
  setChildren(container,
    h('p', { class: 'status-line error' }, `No one called “${input}” is on the schedule.`),
    suggestions.length
      ? h('div', { class: 'suggestions' },
          h('span', { class: 'quiet' }, 'Did you mean'),
          suggestions.map(n => h('button', { type: 'button', class: 'button small', onclick: () => onPick(n) }, n)))
      : h('p', { class: 'quiet' }, 'Check the spelling against the PDF.'),
  );
}

// Merged cells the app couldn't split, plus notes from reading the PDF.
export function renderReview(container, schedules, { onFix }) {
  const fixes = [];
  schedules.forEach(s => s.rows.forEach((row, rowIndex) => row.unresolved.forEach((fix, fixIndex) => {
    fixes.push({ s, row, rowIndex, fix, fixIndex });
  })));
  const notes = schedules.flatMap(s => s.warnings.map(w => `${s.label}: ${w}`));

  if (!fixes.length && !notes.length) { container.hidden = true; container.replaceChildren(); return; }
  container.hidden = false;

  const fixNodes = fixes.map(({ s, row, rowIndex, fix, fixIndex }) => {
    const inputs = fix.columns.map((col, i) => h('input', { type: 'text', value: fix.guess[i] ?? '', 'aria-label': `Name in ${col === 'Leader' ? 'Leader' : `position ${col}`}` }));
    return h('form', {
      class: 'fix',
      onsubmit: e => { e.preventDefault(); onFix(s.id, rowIndex, fixIndex, inputs.map(i => i.value)); },
    },
      h('p', {}, `${shortDate(row.date)} ${weekdayOf(row.date)}, Show ${row.show}: “${fix.text}” runs across ${fix.columns.length} cells. Type the name in each cell.`),
      h('div', { class: 'fix-fields' },
        fix.columns.map((col, i) => h('label', {}, col === 'Leader' ? 'Leader' : `Position ${col}`, inputs[i]))),
      h('button', { type: 'submit', class: 'button small primary' }, 'Save names'),
    );
  });

  setChildren(container,
    fixes.length ? h('h2', {}, 'Fix these names first') : null,
    fixes.length ? h('p', { class: 'quiet' }, 'Two names were stuck together in the PDF. Results show once they are fixed.') : null,
    ...fixNodes,
    notes.length
      ? h('details', {},
          h('summary', {}, `Notes from reading the PDF (${notes.length})`),
          h('ul', {}, notes.map(n => h('li', {}, n))))
      : null,
  );
}

function slotFor(day, show, suggestionsByKey) {
  const worked = day.shifts.find(s => s.show === show);
  if (worked) {
    const pos = worked.position ? `position ${worked.position}` : 'leader';
    const label = `Show ${show}: working, ${pos}${worked.isLeader ? ', leading' : ''}`;
    return h('span', { class: `slot worked${worked.isLeader ? ' lead' : ''}`, role: 'img', 'aria-label': label, title: label }, show);
  }
  const s = suggestionsByKey.get(`${day.date}#${show}`);
  if (s?.allowed) {
    const label = `Show ${show}: you can add it (+${formatMinutes(s.addsMinutes)})`;
    return h('span', { class: 'slot can', role: 'img', 'aria-label': label, title: label }, '+');
  }
  const label = s?.blockedBy
    ? `Show ${show}: would go over 28h in ${range(s.blockedBy)}`
    : `Show ${show}: not working`;
  return h('span', { class: 'slot blocked', role: 'img', 'aria-label': label, title: label }, show);
}

export function renderResult(container, result) {
  if (!result) { container.hidden = true; container.replaceChildren(); return; }
  container.hidden = false;

  const over = result.overWindows;
  const worst = over.length ? over.reduce((a, b) => (b.minutes > a.minutes ? b : a)) : result.highest;
  const remainingByDate = new Map(result.remaining.map(r => [r.date, r]));
  const suggestionsByKey = new Map(result.suggestions.map(s => [`${s.date}#${s.show}`, s]));
  const overDates = new Set();
  for (const w of over) for (const d of result.days) if (d.date >= w.start && d.date <= w.end && d.minutes > 0) overDates.add(d.date);

  const verdict = over.length
    ? h('div', { class: 'verdict over' },
        h('p', { class: 'verdict-line' }, 'Over 28 hours'),
        h('p', {}, `${range(worst)}: ${formatMinutes(worst.minutes)}, which is ${formatMinutes(worst.minutes - WEEK_LIMIT)} over.`),
        over.length > 1 ? h('p', { class: 'quiet' }, `${over.length} of the 7-day windows go over. They are marked below.`) : null)
    : h('div', { class: 'verdict ok' },
        h('p', { class: 'verdict-line' }, 'Within 28 hours'),
        worst ? h('p', {}, `Your busiest 7 days: ${formatMinutes(worst.minutes)} (${range(worst)}).`) : null);

  const notes = [];
  if (result.totalShifts === 0) notes.push(h('p', { class: 'note warn' }, `${result.name} has no shifts on these schedules.`));
  notes.push(h('p', { class: 'note' },
    `Counts only shifts at this workplace from ${shortDate(result.first)} to ${shortDate(result.last)}. ` +
    'Days outside the schedule are unknown, so the first and last six days only count what is shown here.' +
    (result.hasGaps ? ' There is a gap between your saved schedules; those days are unknown too.' : '')));

  const legend = h('div', { class: 'legend', 'aria-hidden': 'true' },
    h('span', {}, h('span', { class: 'slot worked' }), 'Working'),
    h('span', {}, h('span', { class: 'slot worked lead' }), 'Leading'),
    h('span', {}, h('span', { class: 'slot can' }), 'Can add'),
    h('span', {}, h('span', { class: 'slot blocked' }), 'Would go over'),
  );

  const days = h('ol', { class: 'days' }, result.days.map((day, i) => {
    const rem = remainingByDate.get(day.date);
    const isMonday = weekdayOf(day.date) === 'Mon' && i > 0;
    return h('li', { class: `day${overDates.has(day.date) ? ' is-over' : ''}${isMonday ? ' weekend-start' : ''}` },
      h('span', { class: 'date' }, h('strong', {}, shortDate(day.date)), h('small', {}, weekdayOf(day.date))),
      h('span', { class: 'slots' }, SHOW_NUMBERS.map(n => slotFor(day, n, suggestionsByKey))),
      h('span', { class: 'hours' },
        h('strong', {}, day.minutes ? formatMinutes(day.minutes) : 'Off'),
        h('small', { class: rem.minutes === 0 ? 'zero' : '' },
          rem.minutes === 0
            ? (rem.limitedBy.over ? 'Over' : 'Full')
            : `${formatMinutes(rem.minutes)} left`)),
    );
  }));

  const windows = h('details', { open: over.length ? true : undefined },
    h('summary', {}, `Every 7-day window (${result.windows.length})`),
    h('ul', { class: 'windows' }, result.windows.map(w => h('li', { class: `window${w.over ? ' over' : ''}${w.partial ? ' partial' : ''}` },
      h('span', { class: 'range' }, range(w), w.partial ? h('small', {}, 'partly unknown') : null),
      h('span', { class: 'bar', role: 'img', 'aria-label': `${formatMinutes(w.minutes)} of 28h` },
        h('span', { style: { width: `${Math.min(100, (w.minutes / WEEK_LIMIT) * 100).toFixed(1)}%` } })),
      h('span', { class: 'mins' }, formatMinutes(w.minutes)),
    ))),
  );

  setChildren(container,
    verdict,
    ...notes,
    h('h3', {}, `${result.name}'s days`),
    legend,
    h('p', { class: 'quiet' }, 'Each + is checked on its own, assuming you lead that show. Adding two shows uses up room for both.'),
    days,
    h('h3', {}, '7-day totals'),
    windows,
  );
}
