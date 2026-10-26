import { describe, expect, it } from 'vitest';
import type { BenchmarkResult } from '../db/types';
import { rec, result } from '../test/factories';
import { loadProgramme } from '../test/fixtures';
import { monthReview, reviewText } from './review';
import { segments, trendFor } from './trend';

const p = loadProgramme();
const fb = (date: string, r: number, l: number, over: Partial<BenchmarkResult> = {}) =>
  result({ benchmarkId: 'FB', date, sessionRecordId: 's', values: { kind: 'FB', right: { sell: r, exit: 0, eyes: 0 }, left: { sell: l, exit: 0, eyes: 0 } }, ...over });
const db = (date: string, rt: number, re: number, lt = 10, le = 0, over: Partial<BenchmarkResult> = {}) =>
  result({ benchmarkId: 'DB', date, sessionRecordId: 's', values: { kind: 'DB', right: { timeS: rt, errors: re }, left: { timeS: lt, errors: le } }, ...over });

describe('trendFor', () => {
  it('joins only results at the latest conditions; other layouts and unreliable results are listed apart', () => {
    const rs = [
      fb('2027-01-03T18:00:00Z', 20, 15, { conditions: { layoutVersion: 1, cueLevel: 'std', floor: 'hard', recorded: false, recordedBy: 'parent' } }),
      fb('2027-01-10T18:00:00Z', 22, 17),
      fb('2027-01-17T18:00:00Z', 30, 30, { flagged: 'start tone missed' }),
      fb('2027-01-24T18:00:00Z', 24, 19),
    ].map((r, i) => (i === 0 ? { ...r, conditions: { ...r.conditions, layoutVersion: 2 } } : r));
    // The latest reliable result is at layout v1, so the v2 one is excluded.
    const t = trendFor(rs, 'FB')!;
    expect(t.included.map((r) => r.date.slice(0, 10))).toEqual(['2027-01-10', '2027-01-24']);
    expect(t.excluded[0].reason).toMatch(/different room layout/);
    expect(t.unreliable).toHaveLength(1);
    const score = t.panels.find((x) => x.id === 'score')!;
    expect(score.max).toBe(30);
    expect(score.series.map((s) => s.side)).toEqual(['right', 'left']);
    expect(score.series[1].points.map((x) => x.value)).toEqual([17, 19]);
  });

  it('charts a time with its errors in a separate panel, never a combined score', () => {
    const t = trendFor([db('2027-01-03T18:00:00Z', 9.8, 1), db('2027-01-10T18:00:00Z', 9.4, 2)], 'DB')!;
    expect(t.panels.map((x) => x.id)).toEqual(['time', 'errors']);
    expect(t.panels[1].series[0].points.map((x) => x.value)).toEqual([1, 2]);
  });

  it('splits the gate test from the V-pull counts', () => {
    const cb = result({ benchmarkId: 'CB', values: { kind: 'CB', cb1: { right: 20, left: 15 }, cb2: { right: 4, left: 3 } } });
    const t = trendFor([cb], 'CB')!;
    expect(t.panels.map((x) => x.id)).toEqual(['gate', 'vpulls']);
  });

  it('leaves a gap when weeks are missing', () => {
    const pts = ['2027-01-01', '2027-01-08', '2027-02-20', '2027-02-27'].map((d, i) => ({ date: `${d}T18:00:00Z`, resultId: String(i), attempt: 1, value: i }));
    expect(segments(pts).map((s) => s.length)).toEqual([2, 2]);
  });
});

describe('monthReview', () => {
  const base = { programme: p, notes: [], overrides: [], advancements: [], weeklyTarget: 3 };

  it('counts completed sessions only and lists the month’s benchmark changes with errors', () => {
    const records = [
      rec({ id: 's', areaId: 'dribbling', sessionNumber: 3, date: '2027-01-05T18:00:00Z' }),
      rec({ areaId: 'scanning', sessionNumber: 2, date: '2027-01-07T18:00:00Z' }),
      rec({ areaId: 'scanning', sessionNumber: 3, date: '2027-01-09T18:00:00Z', status: 'partial' }),
      rec({ areaId: 'scanning', sessionNumber: 3, date: '2027-01-11T18:00:00Z', trial: true }),
      rec({ areaId: 'scanning', sessionNumber: 4, date: '2027-02-02T18:00:00Z' }),
    ];
    const results = [db('2026-12-20T18:00:00Z', 10.1, 0), db('2027-01-05T18:00:00Z', 9.8, 1), db('2027-01-26T18:00:00Z', 9.4, 1), fb('2026-12-20T18:00:00Z', 20, 14), fb('2027-01-12T18:00:00Z', 24, 19)];
    const m = monthReview({ ...base, records, results }, 2027, 0, new Date('2027-03-01'));
    expect(m.completed).toBe(2);
    expect(m.partial).toBe(1);
    expect(m.planned).toBe(13); // 3 a week over 31 days
    expect(m.areas.map((a) => `${a.id} ${a.sessions}`)).toEqual(['scanning 1', 'dribbling 1']);
    expect(m.benchmarks).toContain('DB R 9.8→9.4 s (errors 1→1), L 10→10 s (errors 0→0)');
    expect(m.benchmarks).toContain('FB R 24/30, L 19/30');
    expect(m.leftRight).toEqual(['FB left 79% of right (was 70%)']);
    expect(reviewText(m, 2)).toMatch(/Consistency: 2 of 13 planned sessions completed \(1 partial\)\n/);
    expect(reviewText(m, 2)).toMatch(/Clips marked for review: 2$/);
  });

  it('plans only the days so far in the current month, and lists advancement and coach changes', () => {
    const m = monthReview(
      {
        ...base,
        records: [],
        results: [],
        advancements: [{ areaId: 'scanning', from: 'st1', to: 'st2', date: '2027-01-24T10:00:00Z', decision: 'confirmed', criteriaText: '', author: 'parent' }],
        notes: [{ date: '2027-01-12T10:00:00Z', author: 'coach', target: { kind: 'drill', id: 'F3' }, body: 'x' }],
        overrides: [{ date: '2027-01-12T11:00:00Z', author: 'coach', target: { kind: 'drill', id: 'F3' }, field: 'cues', value: [], previousValue: [] }],
      },
      2027,
      0,
      new Date(2027, 0, 15),
    );
    expect(m.planned).toBe(6);
    expect(m.advanced[0]).toMatch(/^Scanning Stage 1→2 \(confirmed /);
    expect(m.coach[0]).toMatch(/^1 note \(/);
    expect(m.coach[1]).toBe('changes: F3 cues');
  });
});
