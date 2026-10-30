// Local days around midnight in London during summer time (audit task 17).
process.env.TZ = 'Europe/London';
import { describe, expect, it } from 'vitest';
import { localDate } from './dates';

describe('local dates (London, summer time)', () => {
  it('just after midnight local is the new day, though UTC is still the previous one', () => {
    // 00:30 on 1 Jul in London (BST) = 23:30 UTC on 30 Jun.
    expect(localDate(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
  });
});
