import { describe, expect, it } from 'vitest';
import { reviewDue, trend } from './trend';

describe('trends and spaced review (task 7.6)', () => {
  it('needs enough points, then reads the direction', () => {
    expect(trend([6, 7, 8]).trend).toBe('insufficient');
    expect(trend([5, 6, 7, 8, 9]).trend).toBe('improving');
    expect(trend([9, 8, 7, 6, 5]).trend).toBe('deteriorating');
    expect(trend([7, 8, 7, 8, 7, 8]).trend).toBe('stable');
    // Times: lower is better.
    expect(trend([12, 11.5, 11, 10.4], false).trend).toBe('improving');
  });
  it('mastered skills come back for review after a gap', () => {
    const now = new Date('2026-12-20');
    expect(reviewDue('2026-12-01', true, now)).toBe(true);
    expect(reviewDue('2026-12-15', true, now)).toBe(false);
    expect(reviewDue('2026-11-01', false, now)).toBe(false);
  });
});
