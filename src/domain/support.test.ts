import { describe, expect, it } from 'vitest';
import type { BenchmarkResult } from '../db/types';
import { result } from '../test/factories';
import { supportFor } from './support';

const earlier = (correct: number) => result({ benchmarkId: 'SB', values: { kind: 'SB', correct } }) as BenchmarkResult;
const claim = (correct: number) => ({ kind: 'SB' as const, correct });

describe('what backs a player score (owner decision 2026-10-30)', () => {
  it("the camera's own count agrees: strong", () => {
    expect(supportFor({ claimed: claim(8), cameraEstimate: { correct: 7 }, history: [], practiceAccuracy: [] }).level).toBe('strong');
  });
  it('the camera disagrees: counted, to check, with the reason', () => {
    const s = supportFor({ claimed: claim(9), cameraEstimate: { correct: 5 }, history: [earlier(9)], practiceAccuracy: [] });
    expect(s.level).toBe('check');
    expect(s.reasons[0]).toBe('the camera counted 5, the player 9');
  });
  it('in line with earlier results and recent practice: strong; far above them: check', () => {
    expect(supportFor({ claimed: claim(8), history: [earlier(7), earlier(8)], practiceAccuracy: [0.75] }).level).toBe('strong');
    expect(supportFor({ claimed: claim(10), history: [earlier(6)], practiceAccuracy: [] }).level).toBe('check');
    expect(supportFor({ claimed: claim(9), history: [], practiceAccuracy: [0.5, 0.6] }).level).toBe('check');
  });
  it('nothing to compare with yet: check', () => {
    expect(supportFor({ claimed: claim(8), history: [], practiceAccuracy: [] })).toEqual({ method: 'support-1', level: 'check', reasons: ['nothing else to compare with yet'] });
  });
  it('timed tests: a time far faster than the best before is checked', () => {
    const db = (t: number) => ({ kind: 'DB' as const, right: { timeS: t, errors: 1 }, left: { timeS: t, errors: 1 } });
    const prev = result({ benchmarkId: 'DB', values: db(20) }) as BenchmarkResult;
    expect(supportFor({ claimed: db(19.5), history: [prev], practiceAccuracy: [] }).level).toBe('strong');
    expect(supportFor({ claimed: db(15), history: [prev], practiceAccuracy: [] }).level).toBe('check');
  });
});
