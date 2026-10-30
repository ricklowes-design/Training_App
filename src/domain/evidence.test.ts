import { describe, expect, it } from 'vitest';
import type { AdvancementRule } from '../content/types';
import type { BenchmarkResult, Conditions } from '../db/types';
import { evaluateRule, evidenceFor } from './advancement';
import { comparability } from './comparability';
import { loadProgramme } from '../test/fixtures';
import { result } from '../test/factories';

// One provenance and eligibility contract for comparison and advancement (Brief R02).

const p = loadProgramme();
const base: Conditions = { layoutVersion: 1, cueLevel: '3', floor: 'hard', recorded: false, recordedBy: 'parent', modelVersion: 'rules-1', cameraConfidence: 'none' };
const sb = (date: string, correct: number, c: Partial<Conditions> = {}, extra: Partial<BenchmarkResult> = {}) =>
  ({ ...result({ benchmarkId: 'SB', areaId: 'scanning', date, values: { kind: 'SB', correct }, conditions: { ...base, ...c } }), ...extra }) as BenchmarkResult;
const rule: AdvancementRule = { areaId: 'scanning', from: 'st1', to: 'st2', benchmarkId: 'SB', checks: [{ metric: 'correct', op: '>=', value: 8 }], consecutive: 2 } as AdvancementRule;

describe('comparison contract', () => {
  it('an unknown model version does not match a known one', () => {
    const c = comparability(sb('2026-11-05', 9), sb('2026-11-04', 9, { modelVersion: undefined }));
    expect(c).toMatchObject({ ok: false, legacy: true });
  });
  it('different timing methods do not join', () => {
    expect(comparability(sb('2026-11-05', 9, { timing: 'tap' }), sb('2026-11-04', 9, { timing: 'parent' })).ok).toBe(false);
  });
  it('different cue levels mix only when a rule lists both', () => {
    const a = sb('2026-11-05', 9, { cueLevel: '2' });
    const b = sb('2026-11-04', 9, { cueLevel: '3' });
    expect(comparability(a, b).ok).toBe(false);
    expect(comparability(a, b, { cueLevels: ['2', '3'] }).ok).toBe(true);
  });
});

describe('evidence contract', () => {
  it('self-scored, flagged and unvalidated automatic scores cannot promote, each with a reason and a next step', () => {
    expect(evidenceFor(sb('2026-11-04', 9, { recordedBy: 'self' }))).toMatchObject({ ok: false, reason: 'scored by the player alone' });
    expect(evidenceFor(sb('2026-11-04', 9, {}, { flagged: 'tone missed' }))).toMatchObject({ ok: false });
    const auto = evidenceFor(sb('2026-11-04', 9, { recordedBy: 'app' }));
    expect(auto).toMatchObject({ ok: false, reason: 'automatic score not yet validated' });
    if (!auto.ok) expect(auto.next.length).toBeGreaterThan(0);
  });
  it('a parent-scored manual test, also one started from a camera estimate, stays usable', () => {
    expect(evidenceFor(sb('2026-11-04', 9)).ok).toBe(true);
    expect(evidenceFor(sb('2026-11-04', 9, {}, { prefilledFrom: 'camera' })).ok).toBe(true);
  });
  it('the quiz, scored against its own answer key, is valid app evidence', () => {
    const q = { ...sb('2026-11-04', 9, { recordedBy: 'app' }), benchmarkId: 'QUIZ' };
    expect(evidenceFor(q).ok).toBe(true);
  });
});

describe('advancement uses the same contract', () => {
  it('two passes under different model versions do not qualify', () => {
    const st = evaluateRule(p, rule, [sb('2026-11-03T10:00:00', 9, { modelVersion: 'rules-1+p1' }), sb('2026-11-04T10:00:00', 9)], []);
    expect(st.qualifying).toBe(1);
    expect(st.met).toBe(false);
    expect(st.notCounted[0].reason).toMatch(/different model version/);
  });
  it('an old result without the model field does not qualify with a new one, and stays listed', () => {
    const st = evaluateRule(p, rule, [sb('2026-11-03T10:00:00', 9, { modelVersion: undefined }), sb('2026-11-04T10:00:00', 9)], []);
    expect(st.qualifying).toBe(1);
    expect(st.notCounted).toHaveLength(1);
  });
  it('two comparable parent-scored passes on different days qualify; two on one day count once', () => {
    expect(evaluateRule(p, rule, [sb('2026-11-03T10:00:00', 9), sb('2026-11-04T10:00:00', 8)], []).met).toBe(true);
    expect(evaluateRule(p, rule, [sb('2026-11-04T09:00:00', 9), { ...sb('2026-11-04T10:00:00', 8), attempt: 2 }], []).met).toBe(false);
  });
  it('a self-scored latest result does not reset the context: the parent-scored ones still count', () => {
    const st = evaluateRule(p, rule, [sb('2026-11-03T10:00:00', 9), sb('2026-11-04T10:00:00', 9), sb('2026-11-05T10:00:00', 9, { recordedBy: 'self' })], []);
    expect(st.met).toBe(true);
    expect(st.selfScoredIgnored).toBe(1);
  });
});
