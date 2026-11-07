import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayMinutes, groupConsecutive } from '../js/hours.js';

const s = (show, isLeader = false) => ({ show, isLeader });

test('groupConsecutive splits at gaps', () => {
  assert.deepEqual(groupConsecutive([1, 2, 4, 5]), [[1, 2], [4, 5]]);
  assert.deepEqual(groupConsecutive([3]), [[3]]);
  assert.deepEqual(groupConsecutive([]), []);
});

test('single shows', () => {
  assert.equal(dayMinutes([s(1)]), 180);
  assert.equal(dayMinutes([s(3)]), 180);
  assert.equal(dayMinutes([s(5)]), 195); // 18:45–22:00
});

test('back-to-back shows remove the 30-minute overlap', () => {
  assert.equal(dayMinutes([s(1), s(2)]), 330); // 5.5h, not 6h
  assert.equal(dayMinutes([s(3), s(4)]), 330);
});

test('breaks by number of shows in the day', () => {
  assert.equal(dayMinutes([s(1), s(2), s(3)]), 435);           // 8h - 45m
  assert.equal(dayMinutes([s(1), s(2), s(3), s(4)]), 570);     // 10.5h - 1h
  assert.equal(dayMinutes([s(1), s(2), s(3), s(4), s(5)]), 615); // 13.25h - 3h
});

test('worked examples from the 11/9 schedule', () => {
  // Ada: leads 1-3 → 8:30–16:45 = 8.25h, minus 45m
  assert.equal(dayMinutes([s(1, true), s(2, true), s(3, true)]), 450);
  // Miko: leads 4-5 → 16:15–22:15 = 6h, no break
  assert.equal(dayMinutes([s(4, true), s(5, true)]), 360);
  // Nico: 1,2,4,5 → 5.5h + 5.75h, minus 1h (4 shows that day)
  assert.equal(dayMinutes([s(1), s(2), s(4), s(5)]), 615);
});

test('leader of all five shows gets both 15-minute extras', () => {
  assert.equal(dayMinutes([1, 2, 3, 4, 5].map(n => s(n, true))), 645);
});

test('leading a middle show adds nothing', () => {
  assert.equal(dayMinutes([s(3, true)]), 180);
});

test('edge inputs', () => {
  assert.equal(dayMinutes([]), 0);
  assert.equal(dayMinutes([s(4), s(4)]), 180); // repeated show counts once
  assert.throws(() => dayMinutes([s(6)]), RangeError);
  assert.throws(() => dayMinutes([s(0)]), RangeError);
  assert.throws(() => dayMinutes(null), TypeError);
});

test('order of shifts does not matter', () => {
  assert.equal(dayMinutes([s(5), s(1), s(4), s(2)]), 615);
});
