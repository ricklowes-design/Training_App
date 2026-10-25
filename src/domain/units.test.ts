import { describe, expect, it } from 'vitest';
import { fmtLen, fromFtIn, localiseText, toFtIn } from './units';

describe('length units', () => {
  it('shows metres or feet and inches', () => {
    expect(fmtLen(1.5)).toBe('1.5 m');
    expect(fmtLen(0.8)).toBe('0.8 m');
    expect(fmtLen(6.1, 'imperial')).toBe('20 ft');
    expect(fmtLen(1.5, 'imperial')).toBe('4 ft 11 in');
    expect(fmtLen(0.3, 'imperial')).toBe('1 ft');
    expect(fmtLen(0.2, 'imperial')).toBe('8 in');
  });

  it('enters feet and inches and keeps metres underneath', () => {
    expect(fromFtIn(20, 0)).toBeCloseTo(6.096, 3);
    expect(toFtIn(3.0)).toEqual({ ft: 9, inch: 10 });
    expect(toFtIn(fromFtIn(12, 7))).toEqual({ ft: 12, inch: 7 });
  });

  it('converts lengths in programme text, and nothing else', () => {
    expect(localiseText('1.5 m square in the middle; cue screen 1.5 m behind the box', 'imperial')).toBe('4 ft 11 in square in the middle; cue screen 4 ft 11 in behind the box');
    expect(localiseText('about 6 × 3 m of clear floor', 'imperial')).toBe('about 19 ft 8 in × 9 ft 10 in of clear floor');
    expect(localiseText('3 × 45 s, rest 20 s; 5 min', 'imperial')).toBe('3 × 45 s, rest 20 s; 5 min');
    expect(localiseText('no speed in m/s', 'imperial')).toBe('no speed in m/s');
    expect(localiseText('1.5 m square', 'metric')).toBe('1.5 m square');
  });
});
