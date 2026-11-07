import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, findExact, suggest, allNames, sameName } from '../js/nameMatch.js';

const names = ['Hina', 'Hinata', 'Sean IRL', 'Sean USA', '鈴木花', 'Nico'];

test('similar names stay separate', () => {
  assert.equal(findExact('Hina', names), 'Hina');
  assert.equal(findExact('Hinata', names), 'Hinata');
  assert.equal(findExact('Sean', names), null);
  assert.equal(findExact('Sean IRL', names), 'Sean IRL');
  assert.equal(findExact('sean usa', names), 'Sean USA');
});

test('Japanese names match, with or without spaces', () => {
  assert.equal(findExact('鈴木花', names), '鈴木花');
  assert.equal(findExact('鈴木 花', names), '鈴木花');
  assert.equal(findExact('鈴木　花', names), '鈴木花'); // full-width space
});

test('full-width letters, case and spacing are ignored', () => {
  assert.equal(findExact('Ｎｉｃｏ', names), 'Nico');
  assert.equal(findExact('  NICO ', names), 'Nico');
  assert.equal(findExact('sean   irl', names), 'Sean IRL');
  assert.equal(normalize('Sean  IRL'), 'sean irl');
});

test('empty input matches nothing', () => {
  assert.equal(findExact('', names), null);
  assert.equal(findExact('   ', names), null);
  assert.equal(sameName('', ''), false);
});

test('suggestions put prefix matches first', () => {
  assert.deepEqual(suggest('hin', names), ['Hina', 'Hinata']);
  assert.deepEqual(suggest('sean', names), ['Sean IRL', 'Sean USA']);
  assert.deepEqual(suggest('usa', names), ['Sean USA']);
});

test('allNames collects leaders and positions once each', () => {
  const schedules = [{
    rows: [
      { leader: 'Ada', positions: { A: '鈴木花', B: '', I: 'Ada' } },
      { leader: '', positions: { A: 'ada', C: 'Nico' } },
    ],
  }];
  assert.deepEqual(allNames(schedules), ['Ada', 'Nico', '鈴木花']);
});
