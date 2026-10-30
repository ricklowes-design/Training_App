import { describe, expect, it } from 'vitest';
import type { BenchmarkResult } from '../db/types';
import { loadProgramme } from '../test/fixtures';
import { rec, result } from '../test/factories';
import { evaluateRule, plateau, ruleFor } from './advancement';
import { computeMilestones } from './milestones';
import { applyOverrides } from './overrides';

const p = loadProgramme();
const sb = (date: string, correct: number, cueLevel = '3', layoutVersion = 1): BenchmarkResult =>
  result({ benchmarkId: 'SB', areaId: 'scanning', date, values: { kind: 'SB', correct }, conditions: { layoutVersion, cueLevel, floor: 'hard', recorded: false, recordedBy: 'parent' } });

describe('advancement criteria', () => {
  const rule = ruleFor(p, 'scanning', 'st1')!;

  it('needs two consecutive qualifying tests (plan/04 §4.6 week 3: 1 of 2)', () => {
    const one = evaluateRule(p, rule, [sb('2026-11-22T10:00:00Z', 9)], []);
    expect(one.qualifying).toBe(1);
    expect(one.met).toBe(false);
    const two = evaluateRule(p, rule, [sb('2026-11-22T10:00:00Z', 9), sb('2026-11-29T10:00:00Z', 8)], []);
    expect(two.met).toBe(true);
  });

  it('a failing test resets the run', () => {
    const r = evaluateRule(p, rule, [sb('2026-11-01T10:00:00Z', 9), sb('2026-11-08T10:00:00Z', 6), sb('2026-11-15T10:00:00Z', 9)], []);
    expect(r.qualifying).toBe(1);
  });

  it('only counts tests at the stated cue level', () => {
    const r = evaluateRule(p, rule, [sb('2026-11-01T10:00:00Z', 9, '2'), sb('2026-11-08T10:00:00Z', 9, '2')], []);
    expect(r.met).toBe(false);
  });

  it('only joins tests at the latest layout version', () => {
    const r = evaluateRule(p, rule, [sb('2026-11-01T10:00:00Z', 9, '3', 1), sb('2026-11-08T10:00:00Z', 9, '3', 2)], []);
    expect(r.qualifying).toBe(1);
  });

  it('feinting checks the left/right ratio', () => {
    const fr = ruleFor(p, 'feinting', 'st1')!;
    const fb = (left: number, right: number, date: string) =>
      result({
        benchmarkId: 'FB',
        areaId: 'feinting',
        date,
        values: { kind: 'FB', left: { sell: left, exit: left, eyes: left }, right: { sell: right, exit: right, eyes: right } },
        conditions: { layoutVersion: 1, cueLevel: 'walk', floor: 'hard', recorded: false, recordedBy: 'parent' },
      });
    expect(evaluateRule(p, fr, [fb(6, 8, '2026-11-01T00:00:00Z'), fb(6, 8, '2026-11-08T00:00:00Z')], []).met).toBe(true); // 42/60, left 75%
    expect(evaluateRule(p, fr, [fb(5, 9, '2026-11-01T00:00:00Z'), fb(5, 9, '2026-11-08T00:00:00Z')], []).met).toBe(false); // 42/60, left 56%
  });

  it('stage 4 exit no longer needs a coach transfer note: it waits on the parent confirmation (owner decision 2026-10-30)', () => {
    const exit = ruleFor(p, 'feinting', 'st4')!;
    expect(evaluateRule(p, exit, [], []).met).toBe(true);
    expect(evaluateRule(p, exit, [], []).criteriaText).toMatch(/a parent confirms after a feedback session with the coach/);
  });

  it('every stage rule with a test needs passes on two different days (owner decision 2026-10-30)', () => {
    expect(p.advancementRules.filter((r) => r.benchmarkId).every((r) => r.consecutive >= 2)).toBe(true);
  });

  it('an open custom criterion holds advancement back', () => {
    const r = evaluateRule(p, rule, [sb('2026-11-22T10:00:00Z', 9), sb('2026-11-29T10:00:00Z', 8)], [], [{ areaId: 'scanning', from: 'st1', text: 'both feet', date: '' }]);
    expect(r.met).toBe(false);
  });

  it('detects a plateau of three equal comparable results', () => {
    const list = [sb('2026-11-01T00:00:00Z', 7), sb('2026-11-08T00:00:00Z', 7), sb('2026-11-15T00:00:00Z', 7)];
    expect(plateau(list, 'SB', 'scanning')).toEqual({ count: 3, value: '7/10' });
    expect(plateau([...list, sb('2026-11-22T00:00:00Z', 8)], 'SB', 'scanning')).toBeNull();
  });
});

describe('coach overrides', () => {
  it('change a drill without touching the content, and revert', () => {
    const o = { id: 1, date: '2026-01-12', author: 'coach via parent', target: { kind: 'drill' as const, id: 'F3' }, field: 'cues', value: ['Half-size circle'], previousValue: ['Small circle, big push'] };
    expect(applyOverrides(p, [o]).drills.find((d) => d.id === 'F3')!.cues).toEqual(['Half-size circle']);
    expect(p.drills.find((d) => d.id === 'F3')!.cues).not.toEqual(['Half-size circle']);
    expect(applyOverrides(p, [{ ...o, revertedAt: '2026-01-20' }]).drills.find((d) => d.id === 'F3')!.cues).toEqual(p.drills.find((d) => d.id === 'F3')!.cues);
  });

  it('the latest override of a field wins', () => {
    const base = { author: 'coach', target: { kind: 'drill' as const, id: 'F3' }, field: 'prescription', previousValue: '' };
    const out = applyOverrides(p, [
      { ...base, id: 2, date: '2026-02-01', value: 'second' },
      { ...base, id: 1, date: '2026-01-01', value: 'first' },
    ]);
    expect(out.drills.find((d) => d.id === 'F3')!.prescription).toBe('second');
  });
});

describe('milestones', () => {
  it('first completed session per area and 10 sessions, never from trials', () => {
    const recs = Array.from({ length: 10 }, (_, i) => rec({ areaId: 'scanning', sessionNumber: i + 1, date: `2026-11-${String(i + 1).padStart(2, '0')}T18:00:00Z` }));
    const ms = computeMilestones(p, [...recs, rec({ areaId: 'feinting', sessionNumber: 5, trial: true })], [], [], []);
    expect(ms.map((m) => m.id).sort()).toEqual(['first:scanning', 'ten']);
  });
});

describe('competence-based advancement (part 15 D12)', () => {
  const rule = ruleFor(p, 'scanning', 'st1')!;
  it('two passes on the same day count as one day', () => {
    const r = evaluateRule(p, rule, [sb('2026-11-22T10:00:00', 9), sb('2026-11-22T18:00:00', 9)], []);
    expect(r.qualifying).toBe(1);
    expect(r.met).toBe(false);
  });
  it('self-scored results are not evidence', () => {
    const self = (date: string) => ({ ...sb(date, 9), conditions: { ...sb(date, 9).conditions, recordedBy: 'self' as const } });
    const r = evaluateRule(p, rule, [self('2026-11-22T10:00:00'), self('2026-11-29T10:00:00')], []);
    expect(r.met).toBe(false);
    expect(r.selfScoredIgnored).toBe(2);
  });
});
