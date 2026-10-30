// Local days around midnight, in two time zones (audit task 17).
process.env.TZ = 'America/New_York';
import { describe, expect, it } from 'vitest';
import { localDate, localDay } from './dates';

describe('local dates', () => {
  it('late evening in New York is still that day, though UTC is already the next', () => {
    // 23:30 on 3 Nov in New York = 04:30 UTC on 4 Nov.
    const d = new Date('2026-11-04T04:30:00Z');
    expect(d.toISOString().slice(0, 10)).toBe('2026-11-04');
    expect(localDate(d)).toBe('2026-11-03');
    expect(localDay('2026-11-04T04:30:00Z')).toBe('2026-11-03');
  });
});
