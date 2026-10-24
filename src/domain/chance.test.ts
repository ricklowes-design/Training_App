import { describe, expect, it } from 'vitest';
import { chancePct, chanceTail } from './chance';

describe('binomial chance model (task 4.3)', () => {
  it('two outcomes: 8/10 or better by guessing is about 5.5%', () => {
    expect(chanceTail(8, 10, 2)).toBeCloseTo(56 / 1024, 6);
  });
  it('three outcomes: 8/10 by guessing is rare', () => {
    expect(chanceTail(8, 10, 3)).toBeCloseTo((45 * 4 + 10 * 2 + 1) / 59049, 6);
  });
  it('zero correct is certain; more outcomes make the same score less likely by chance', () => {
    expect(chanceTail(0, 10, 3)).toBeCloseTo(1);
    expect(chanceTail(6, 10, 3)).toBeLessThan(chanceTail(6, 10, 2));
  });
  it('formats small probabilities', () => {
    expect(chancePct(0.0034)).toBe('0.3');
    expect(chancePct(0.054)).toBe('5');
  });
});
