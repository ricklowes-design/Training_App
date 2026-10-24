import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { anchorPlan, buildPlan, findSession, noBallPlan, planMinutes, standardPlan } from './plans';

const p = loadProgramme();
const s = (area: string, n: number) => findSession(p, area, n)!;
const shape = (blocks: { kind: string; minutes: number; drillId?: string; benchmarkId?: string }[]) =>
  blocks.map((b) => `${b.kind}${b.drillId ? ':' + b.drillId : ''}${b.benchmarkId ? ':' + b.benchmarkId : ''} ${b.minutes}`);

describe('session duration arithmetic', () => {
  it('every content session adds up to its duration', () => {
    for (const sess of p.sessions) expect(planMinutes(sess.blocks)).toBe(sess.durationMinutes);
  });

  it('the standard session is the content session unchanged', () => {
    const plan = standardPlan(p, s('feinting', 7));
    expect(plan.totalMinutes).toBe(20);
    expect(shape(plan.blocks)).toEqual(['warmup 3', 'work:F2 6', 'rest 1', 'work:F7 6', 'benchmark:FB 3', 'log 1']);
  });

  it('30 minutes, one area, reproduces plan/04 §4.2 (Dribbling S9)', () => {
    const r = buildPlan(p, { minutes: 30, sessions: [s('dribbling', 9)], light: false, partner: false });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.totalMinutes).toBe(30);
    expect(r.plan.blocks.map((b) => b.minutes)).toEqual([4, 7, 1, 7, 1, 5, 4, 1]);
    expect(shape(r.plan.blocks).slice(0, 4)).toEqual(['warmup 4', 'work:D3 7', 'rest 1', 'work:D4 7']);
  });

  it('45 minutes, two areas, reproduces the plan/04 §4.3 timing (Scanning S5 + Ball control S6)', () => {
    const r = buildPlan(p, { minutes: 45, sessions: [s('scanning', 5), s('control', 6)], light: false, partner: false });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.blocks.map((b) => b.minutes)).toEqual([5, 6, 1, 6, 3, 2, 6, 1, 6, 3, 2, 3, 1]);
    expect(r.plan.totalMinutes).toBe(45);
    expect(r.plan.parts.map((x) => x.sessionNumber)).toEqual([5, 6]);
    expect(shape(r.plan.blocks)).toContain('work:S2 6');
    expect(shape(r.plan.blocks)).toContain('work:C2 6');
  });

  it('60 minutes, three areas, reproduces plan/04 §4.4 (Feinting S9 + Dribbling S10 + Ball control S9)', () => {
    const r = buildPlan(p, { minutes: 60, sessions: [s('feinting', 9), s('dribbling', 10), s('control', 9)], light: false, partner: false });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.blocks.map((b) => b.minutes)).toEqual([6, 6, 1, 5, 2, 2, 6, 1, 5, 2, 2, 3, 6, 1, 5, 2, 4, 1]);
    expect(r.plan.totalMinutes).toBe(60);
    expect(shape(r.plan.blocks).slice(1, 4)).toEqual(['work:F5 6', 'rest 1', 'work:F3 5']);
  });

  it('light 20 minutes reproduces plan/04 §4.7: no benchmark, mobility instead', () => {
    const r = buildPlan(p, { minutes: 20, sessions: [s('feinting', 7)], light: true, partner: false });
    if (!r.ok) throw new Error(r.reason);
    expect(shape(r.plan.blocks)).toEqual(['warmup 3', 'work:F2 6', 'rest 1', 'work:F7 6', 'mobility 3', 'log 1']);
    expect(r.plan.blocks.some((b) => b.kind === 'benchmark')).toBe(false);
  });

  it('light longer sessions turn benchmark slots into rest and keep the total', () => {
    const r = buildPlan(p, { minutes: 45, sessions: [s('scanning', 7), s('control', 7)], light: true, partner: false });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.totalMinutes).toBe(45);
    expect(r.plan.blocks.some((b) => b.kind === 'benchmark')).toBe(false);
  });

  it('refuses combinations the content has no template for', () => {
    const r = buildPlan(p, { minutes: 45, sessions: [s('scanning', 5)], light: false, partner: false });
    expect(r.ok).toBe(false);
  });

  it('every builder combination adds up to its duration', () => {
    const areas = p.areas.map((a) => a.id);
    for (const t of p.builder.templates) {
      for (const n of [1, 5, 9, 16]) {
        const sessions = areas.slice(0, t.areas).map((a) => s(a, n));
        const r = buildPlan(p, { minutes: t.minutes, sessions, light: !!t.light, partner: false });
        if (!r.ok) throw new Error(`${t.id}: ${r.reason}`);
        expect(planMinutes(r.plan.blocks)).toBe(t.minutes);
      }
    }
  });

  it('no-ball plan is 10 minutes: quiz plus mobility, an extra', () => {
    const plan = noBallPlan(p);
    expect(plan.totalMinutes).toBe(10);
    expect(plan.parts[0].kind).toBe('extra');
  });

  it('anchor check is 12 minutes and an anchor record', () => {
    const plan = anchorPlan(p);
    expect(plan.totalMinutes).toBe(12);
    expect(plan.blocks.map((b) => b.anchorId ?? b.kind)).toEqual(['warmup', 'A1', 'A2', 'A3', 'A4']);
    expect(plan.parts[0].kind).toBe('anchor');
  });
});
