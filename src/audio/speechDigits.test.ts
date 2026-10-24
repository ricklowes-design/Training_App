import { describe, expect, it } from 'vitest';
import type { CueLogEntry } from '../cue/engine';
import { parseDigits, scoreDigits } from './speechDigits';

describe('speech digit diagnostic (experimental)', () => {
  it('reads digits as numerals and words, including common mishearings', () => {
    expect(parseDigits('seven')).toEqual([7]);
    expect(parseDigits('7')).toEqual([7]);
    expect(parseDigits('for')).toEqual([4]);
    expect(parseDigits('Left, six!')).toEqual([6]);
    expect(parseDigits('hello')).toEqual([]);
  });
  it('scores the first digit called after each cue, within the window, before the next rep', () => {
    const log: CueLogEntry[] = [
      { rep: 0, repStartMs: 0, trigger: 'timed', cueMs: 1000, number: 3, plannedDelayMs: 1000 },
      { rep: 1, repStartMs: 9000, trigger: 'timed', cueMs: 10_000, number: 5, plannedDelayMs: 1000 },
      { rep: 2, repStartMs: 18_000, trigger: 'timed', cueMs: 19_000, number: 8, plannedDelayMs: 1000 },
    ];
    const heard = [
      { tMs: 500, digit: 3 }, // before the cue: ignored
      { tMs: 1800, digit: 3 },
      { tMs: 11_000, digit: 2 },
      { tMs: 11_500, digit: 5 }, // second call in the window: the first one counts
    ];
    expect(scoreDigits(log, heard)).toEqual({ correct: 1, heardReps: 2, reps: 3 });
  });
});

describe('scoreDigits limit', () => {
  it('counts only the first ten reps with a number, matching the /10 card', () => {
    const log = Array.from({ length: 14 }, (_, i) => ({ rep: i, repStartMs: i * 9000, trigger: 'timed', cueMs: i * 9000 + 1000, number: 5 }));
    const heard = log.map((e) => ({ tMs: e.cueMs + 500, digit: 5 }));
    expect(scoreDigits(log as never, heard)).toEqual({ correct: 10, heardReps: 10, reps: 10 });
  });
});
