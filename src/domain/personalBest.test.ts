import { describe, expect, it } from 'vitest';
import { result } from '../test/factories';
import { personalBests } from './personalBest';

const db = (date: string, rt: number, re: number, lt: number, le: number, extra: object = {}) =>
  result({ benchmarkId: 'DB', date, values: { kind: 'DB', right: { timeS: rt, errors: re }, left: { timeS: lt, errors: le } }, ...extra });

describe('personal best (plan/05 §5.1)', () => {
  it('a timed line keeps the fewest errors, then the fastest, with its error count', () => {
    const a = db('2026-11-01T18:00:00Z', 9.5, 2, 11, 1);
    const b = db('2026-11-08T18:00:00Z', 10.2, 0, 10.4, 1);
    const c = db('2026-11-15T18:00:00Z', 9.9, 0, 12, 3);
    const pb = Object.fromEntries(personalBests(c, [a, b]).map((x) => [x.key, x]));
    expect(pb.right.text).toBe('9.9 s · 0 err'); // the faster of the two clean runs, not the fastest overall
    expect(pb.right.isNow).toBe(true);
    expect(pb.left.text).toBe('10.4 s · 1 err');
    expect(pb.left.date).toBe(b.date);
  });

  it('only results at the same conditions, and never one marked unreliable', () => {
    const now = result({ benchmarkId: 'SB', date: '2026-11-15T18:00:00Z', values: { kind: 'SB', correct: 6 } });
    const otherLayout = result({ benchmarkId: 'SB', date: '2026-11-01T18:00:00Z', values: { kind: 'SB', correct: 10 }, conditions: { layoutVersion: 2, cueLevel: 'std', floor: 'hard', recorded: false, recordedBy: 'parent' } });
    const flagged = { ...result({ benchmarkId: 'SB', date: '2026-11-05T18:00:00Z', values: { kind: 'SB', correct: 9 } }), flagged: 'start tone missed' };
    const fair = result({ benchmarkId: 'SB', date: '2026-11-08T18:00:00Z', values: { kind: 'SB', correct: 8 } });
    const [pb] = personalBests(now, [otherLayout, flagged, fair]);
    expect(pb.text).toBe('8/10');
    expect(pb.isNow).toBe(false);
  });

  it('a tie keeps the date the best was first reached', () => {
    const a = result({ benchmarkId: 'SB', date: '2026-11-01T18:00:00Z', values: { kind: 'SB', correct: 8 } });
    const b = result({ benchmarkId: 'SB', date: '2026-11-08T18:00:00Z', values: { kind: 'SB', correct: 8 } });
    expect(personalBests(b, [a])[0].date).toBe(a.date);
  });
});
