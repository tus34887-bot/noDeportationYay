// Entry point: holds the app state, wires the page's controls, and redraws.

import { extractPages } from './pdfParser.js';
import { buildSchedule, applyFix, unresolvedCount } from './scheduleBuilder.js';
import { analyze } from './checker.js';
import { allNames, findExact, suggest } from './nameMatch.js';
import { load, save, askToPersist, addSchedule, deleteSchedule, clearAll, exportJSON, importJSON } from './storage.js';
import { renderSchedules, renderNameOptions, renderNameHelp, renderReview, renderResult } from './render.js';
import { makeIso } from './dates.js';

const $ = id => document.getElementById(id);
const ui = {
  scheduleList: $('schedule-list'),
  pdfInput: $('pdf-input'),
  uploadStatus: $('upload-status'),
  nameBlock: $('name-block'),
  nameForm: $('name-form'),
  nameInput: $('name-input'),
  nameOptions: $('name-options'),
  nameHelp: $('name-help'),
  review: $('review-block'),
  result: $('result-block'),
  exportButton: $('export-button'),
  importInput: $('import-input'),
  clearButton: $('clear-button'),
};

let state = load();
let notFound = { input: '', suggestions: [] };

function localToday() {
  const d = new Date();
  return makeIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function persist() {
  if (!save(state)) setStatus('This browser is not saving data (private mode?). Results still work until you close the page.', true);
}

function setStatus(text, isError = false) {
  ui.uploadStatus.textContent = text;
  ui.uploadStatus.classList.toggle('error', isError);
}

// pdf.js is only loaded when the first PDF is added, to keep the first visit light.
let pdfjsPromise = null;
function loadPdfJs() {
  pdfjsPromise ??= import('../vendor/pdfjs/pdf.min.mjs').then(lib => {
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return lib;
  });
  return pdfjsPromise;
}

function render() {
  const { schedules } = state;
  renderSchedules(ui.scheduleList, schedules, { onDelete });

  ui.nameBlock.hidden = schedules.length === 0;
  const names = allNames(schedules);
  renderNameOptions(ui.nameOptions, names);
  if (document.activeElement !== ui.nameInput && !ui.nameInput.value) ui.nameInput.value = state.name;
  renderNameHelp(ui.nameHelp, notFound, { onPick });

  renderReview(ui.review, schedules, { onFix });

  const blocked = schedules.some(s => unresolvedCount(s) > 0);
  const name = state.name && findExact(state.name, names);
  renderResult(ui.result, !blocked && name ? analyze(schedules, name) : null);
}

async function onPdfChosen(file) {
  if (!file) return;
  setStatus(`Reading ${file.name}…`);
  try {
    const lib = await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const pages = await extractPages(lib, data);
    const schedule = buildSchedule(pages, { today: localToday(), fileName: file.name, uploadedAt: new Date().toISOString() });
    const added = addSchedule(state, schedule);
    state = added.state;
    persist();
    askToPersist();
    const parts = [`Added ${schedule.label}.`];
    if (added.replaced) parts.push('It replaced the earlier copy of the same dates.');
    if (added.overlapping.length) parts.push(`It overlaps ${added.overlapping.join(', ')}; this newer one is used for the shared dates.`);
    setStatus(parts.join(' '));
    render();
    if (!state.name) ui.nameInput.focus();
  } catch (err) {
    console.error(err);
    setStatus(err?.message?.startsWith('No schedule rows') ? err.message : `Couldn't read ${file.name}. Make sure it's the shift schedule PDF.`, true);
  } finally {
    ui.pdfInput.value = '';
  }
}

function onDelete(schedule) {
  if (!confirm(`Remove the ${schedule.label} schedule from this device?`)) return;
  state = deleteSchedule(state, schedule.id);
  persist();
  setStatus(`Removed ${schedule.label}.`);
  render();
}

function onPick(name) {
  ui.nameInput.value = name;
  submitName(name);
}

function submitName(input) {
  const names = allNames(state.schedules);
  const exact = findExact(input, names);
  if (!exact) {
    notFound = { input: input.trim(), suggestions: suggest(input, names) };
    render();
    return;
  }
  notFound = { input: '', suggestions: [] };
  ui.nameInput.value = exact;
  state = { ...state, name: exact };
  persist();
  render();
  ui.result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function onFix(scheduleId, rowIndex, fixIndex, values) {
  const schedule = state.schedules.find(s => s.id === scheduleId);
  if (!schedule) return;
  applyFix(schedule, rowIndex, fixIndex, values);
  state = { ...state };
  persist();
  render();
}

function onExport() {
  const blob = new Blob([exportJSON(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `28h-check-backup-${localToday()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function onImport(file) {
  if (!file) return;
  try {
    const restored = importJSON(await file.text());
    for (const s of restored.schedules) state = addSchedule(state, s).state;
    if (!state.name && restored.name) state = { ...state, name: restored.name };
    persist();
    setStatus(`Restored ${restored.schedules.length} schedule${restored.schedules.length === 1 ? '' : 's'} from the backup.`);
    render();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    ui.importInput.value = '';
  }
}

function onClear() {
  if (!confirm('Remove every saved schedule and your name from this device? This cannot be undone.')) return;
  state = clearAll();
  persist();
  ui.nameInput.value = '';
  notFound = { input: '', suggestions: [] };
  setStatus('Everything was removed from this device.');
  render();
}

ui.pdfInput.addEventListener('change', e => onPdfChosen(e.target.files?.[0]));
ui.importInput.addEventListener('change', e => onImport(e.target.files?.[0]));
ui.exportButton.addEventListener('click', onExport);
ui.clearButton.addEventListener('click', onClear);
ui.nameForm.addEventListener('submit', e => { e.preventDefault(); submitName(ui.nameInput.value); });

render();
