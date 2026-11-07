import {
  SHOWS, BREAK_BY_SHOW_COUNT, LEADER_OPENER_EXTRA, LEADER_CLOSER_EXTRA,
} from './config.js';

// [1, 2, 4, 5] → [[1, 2], [4, 5]]  (input must be sorted and unique)
export function groupConsecutive(nums) {
  const blocks = [];
  for (const n of nums) {
    const last = blocks.at(-1);
    if (last && n === last.at(-1) + 1) last.push(n);
    else blocks.push([n]);
  }
  return blocks;
}

// The one shared calculation. Every worker goes through this; the only
// difference between people is whether they lead Show 1 or Show 5 that day.
//
// shifts: [{ show, isLeader }] for one person on one day → paid minutes.
export function dayMinutes(shifts) {
  if (!Array.isArray(shifts)) throw new TypeError('dayMinutes expects an array of shifts');
  if (shifts.length === 0) return 0;

  // A repeated show counts once.
  const nums = [...new Set(shifts.map(s => s.show))].sort((a, b) => a - b);
  for (const n of nums) {
    if (!Object.hasOwn(SHOWS, n)) throw new RangeError(`Unknown show: ${n}`);
  }

  // Consecutive shows are one continuous block: first start to last end.
  // This is what removes the 30-minute overlap between back-to-back shows.
  let total = 0;
  for (const block of groupConsecutive(nums)) {
    total += SHOWS[block.at(-1)].end - SHOWS[block[0]].start;
  }

  if (shifts.some(s => s.show === 1 && s.isLeader)) total += LEADER_OPENER_EXTRA;
  if (shifts.some(s => s.show === 5 && s.isLeader)) total += LEADER_CLOSER_EXTRA;

  return total - BREAK_BY_SHOW_COUNT[nums.length];
}
