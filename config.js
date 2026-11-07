// All workplace rules live here. Times are minutes after midnight.
// Changing a rule means changing only this file.

export const SHOWS = {
  1: { start: 525,  end: 705  },  // 8:45–11:45
  2: { start: 675,  end: 855  },  // 11:15–14:15
  3: { start: 825,  end: 1005 },  // 13:45–16:45
  4: { start: 975,  end: 1155 },  // 16:15–19:15
  5: { start: 1125, end: 1320 },  // 18:45–22:00
};

export const SHOW_NUMBERS = [1, 2, 3, 4, 5];

// Unpaid break, decided by the number of shows worked that day (whole day, not per block).
export const BREAK_BY_SHOW_COUNT = { 1: 0, 2: 0, 3: 45, 4: 60, 5: 180 };

export const LEADER_OPENER_EXTRA = 15;  // leader of Show 1 starts 15 min early
export const LEADER_CLOSER_EXTRA = 15;  // leader of Show 5 ends 15 min late

export const WEEK_DAYS = 7;
export const WEEK_LIMIT = 28 * 60;      // 1680 min; exactly 28h is allowed

export const POSITIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I'];

export const STORAGE_KEY = 'h28:v1';
export const STORAGE_VERSION = 1;
