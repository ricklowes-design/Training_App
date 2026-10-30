import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { result } from '../test/factories';
import { comparability, lastComparable, pickComparison } from './comparability';
import { comparisonSentences, resultLines } from './metrics';
import { BANNED_PHRASES, fill, TemplateError } from './templates';

const t = loadProgramme().feedbackTemplates;

describe('templates', () => {
  it('fills the plan/05 examples', () => {
    expect(fill(t, 'completed', { area: 'Feinting', n: 7, blocks: 4, minutes: 20 })).toBe('Feinting Session 7 complete: all 4 blocks, 20 minutes.');
    expect(fill(t, 'noSessionsThisWeek', {})).toBe('No completed sessions this week yet. The next one is on Home.');
  });

  it('refuses to fill with a missing value', () => {
    expect(() => fill(t, 'completed', { area: 'Feinting', n: 7, blocks: 4 })).toThrow(TemplateError);
  });

  it('no template contains banned praise or pressure', () => {
    for (const text of Object.values(t)) for (const bad of BANNED_PHRASES) expect(text.toLowerCase()).not.toContain(bad);
  });
});

describe('results and comparisons', () => {
  const db = (rt: number, re: number, lt: number, le: number) => ({ kind: 'DB' as const, right: { timeS: rt, errors: re }, left: { timeS: lt, errors: le } });

  it('a time is never shown without its error count', () => {
    for (const l of resultLines(db(9.8, 1, 11.2, 3))) expect(l.text).toMatch(/s · \d+ err/);
  });

  it('faster with more errors is not called an improvement', () => {
    const s = comparisonSentences(t, 'Slalom', db(9.6, 2, 11.2, 3), db(9.8, 1, 11.2, 3), true);
    expect(s[0]).toBe('Slalom Pattern R: 9.6 s with 2 errors, previously 9.8 s with 1: faster, 1 more error(s).');
    expect(s[0]).not.toMatch(/better this attempt/);
  });

  it('faster with the same errors is an improvement', () => {
    const s = comparisonSentences(t, 'Slalom', db(9.6, 1, 11.2, 3), db(9.8, 1, 11.2, 3), true);
    expect(s[0]).toBe('Slalom Pattern R: 9.6 s · 1 err, better this attempt than 9.8 s · 1 err at the same conditions.');
  });

  it('no improvement claim when conditions differ', () => {
    const s = comparisonSentences(t, 'Gate test', { kind: 'SB', correct: 9 }, { kind: 'SB', correct: 7 }, false);
    expect(s[0]).not.toMatch(/better this attempt/);
  });

  it('comparison across layouts or cue levels is refused with a reason', () => {
    const a = result({ benchmarkId: 'SB', values: { kind: 'SB', correct: 8 }, conditions: { layoutVersion: 2, cueLevel: '3', floor: 'hard', recorded: false, recordedBy: 'parent' } });
    const b = result({ benchmarkId: 'SB', values: { kind: 'SB', correct: 7 }, conditions: { layoutVersion: 1, cueLevel: '3', floor: 'hard', recorded: false, recordedBy: 'parent' } });
    const c = result({ benchmarkId: 'SB', values: { kind: 'SB', correct: 7 }, conditions: { layoutVersion: 2, cueLevel: '2', floor: 'hard', recorded: false, recordedBy: 'parent' } });
    expect(comparability(a, b)).toEqual({ ok: false, reason: 'different room layout (v1 then, v2 now)' });
    expect(comparability(a, c)).toEqual({ ok: false, reason: 'different cue level (cue 2 s then, cue 3 s now)' });
    expect(lastComparable(a, [b, c])).toBeUndefined();
  });

  it('the picker finds last, one month ago, and a picked date', () => {
    const mk = (date: string, correct: number) => result({ benchmarkId: 'SB', date, values: { kind: 'SB', correct } });
    const now = mk('2026-12-20T18:00:00Z', 9);
    const all = [mk('2026-09-15T18:00:00Z', 5), mk('2026-11-18T18:00:00Z', 7), mk('2026-12-10T18:00:00Z', 8), now];
    expect(pickComparison(now, all, { kind: 'last' })?.date).toBe('2026-12-10T18:00:00Z');
    expect(pickComparison(now, all, { kind: 'monthsAgo', months: 1 })?.date).toBe('2026-11-18T18:00:00Z');
    expect(pickComparison(now, all, { kind: 'monthsAgo', months: 3 })?.date).toBe('2026-09-15T18:00:00Z');
    expect(pickComparison(now, all, { kind: 'date', date: '2026-12-01' })?.date).toBe('2026-11-18T18:00:00Z');
  });
});

describe('extended context key (part 15 D11)', () => {
  it('mismatched room profile, defender, task mode or camera never join a trend; unknown never matches known (Brief R02)', async () => {
    const { comparability } = await import('./comparability');
    const { result } = await import('../test/factories');
    const base = { layoutVersion: 1, cueLevel: '3', floor: 'hard', recorded: false, recordedBy: 'parent' as const };
    const r = (extra: object) => result({ benchmarkId: 'SB', values: { kind: 'SB', correct: 8 }, conditions: { ...base, ...extra } });
    expect(comparability(r({ roomProfileVersion: 'room-1@1' }), r({ roomProfileVersion: 'room-1@2' }))).toEqual({ ok: false, reason: 'different room profile (room-1@2 then, room-1@1 now)' });
    expect(comparability(r({ defenderArchetype: 'holding' }), r({ defenderArchetype: 'reactive' })).ok).toBe(false);
    expect(comparability(r({ taskMode: 'rebound' }), r({ taskMode: 'stationarySimulation' })).ok).toBe(false);
    expect(comparability(r({ cameraConfidence: 'ok' }), r({ cameraConfidence: 'low' })).ok).toBe(false);
    // An older result without the field is listed as legacy history, not joined.
    expect(comparability(r({ roomProfileVersion: 'room-1@1' }), r({}))).toEqual({ ok: false, legacy: true, reason: 'room profile not recorded on the earlier result' });
    // A field neither result has is not part of this test's context.
    expect(comparability(r({}), r({})).ok).toBe(true);
  });

  it('a result marked unreliable joins no comparison, either way round', async () => {
    const { result } = await import('../test/factories');
    const base = { layoutVersion: 1, cueLevel: '3', floor: 'hard', recorded: false, recordedBy: 'parent' as const };
    const ok = result({ benchmarkId: 'SB', values: { kind: 'SB', correct: 8 }, conditions: base });
    const bad = { ...result({ benchmarkId: 'SB', values: { kind: 'SB', correct: 9 }, conditions: base }), flagged: 'start tone missed' };
    expect(comparability(ok, bad)).toEqual({ ok: false, reason: 'marked unreliable (start tone missed)' });
    expect(comparability(bad, ok).ok).toBe(false);
    expect(lastComparable(ok, [bad])).toBeUndefined();
  });
});

describe('next stage step on Home (Brief R10)', () => {
  it('says whether the step waits on practice or on a parent', async () => {
    const { tryFill } = await import('./templates');
    const t = loadProgramme().feedbackTemplates;
    expect(tryFill(t, 'nextStepPractice', { criteria: 'SB >= 8/10 at 3 s', qualifying: 1, needed: 2 })).toBe('Next stage step: SB >= 8/10 at 3 s (done on 1 of 2 days).');
    expect(tryFill(t, 'nextStepParent', { criteria: 'SB >= 8/10 at 3 s' })).toBe('Next stage step done: SB >= 8/10 at 3 s. Waiting for a parent to check and confirm.');
  });
});
