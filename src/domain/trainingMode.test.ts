import { describe, expect, it } from 'vitest';
import { validateProgramme } from '../content/validate';
import type { Settings } from '../db/types';
import { loadProgramme } from '../test/fixtures';
import type { RunBlock } from './plans';
import { resolveTraining } from './trainingMode';
import { talkThrough } from '../runner/CueRules';

const p = loadProgramme();
const on = { flags: { defender3d: true }, capabilities: { checkedAt: '', webgl: true, webgl2: true } } as unknown as Settings;
const noGl = { flags: { defender3d: true }, capabilities: { checkedAt: '', webgl: false, webgl2: false } } as unknown as Settings;
const work = (drillId: string): RunBlock => ({ kind: 'work', minutes: 4, mode: 'reps', drillId });
const text = (t: ReturnType<typeof resolveTraining>) => JSON.stringify(t);

describe('training mode (Brief R01)', () => {
  it('F5 with the 3D defender teaches reading the defender, with no arrow anywhere', () => {
    const t = resolveTraining(p, work('F5'), on)!;
    expect(t.mode).toBe('defender3d');
    expect(t.words).toBeUndefined();
    expect(text(t).toLowerCase()).not.toContain('arrow');
    expect(t.read!.length).toBeGreaterThan(0);
    // The spoken talk-through matches the screen.
    const said = talkThrough(p, work('F5'), 'Cue exit', t);
    for (const st of t.steps) expect(said).toContain(st);
    expect(said.toLowerCase()).not.toContain('arrow');
  });

  it('without WebGL the fallback is labelled and teaches its arrow', () => {
    const t = resolveTraining(p, work('F5'), noGl)!;
    expect(t.mode).toBe('cueFallback');
    expect(t.label).toMatch(/word or arrow instead/);
    expect(text(t).toLowerCase()).toContain('arrow');
    expect(t.words!.map((w) => w.value)).toEqual(['LEFT', 'RIGHT']);
  });

  it('an anchor stays fixed (its own cue words), whatever the defender setting', () => {
    const a3: RunBlock = { kind: 'anchor', minutes: 3, mode: 'reps', anchorId: 'A3', drillId: 'F5' };
    expect(resolveTraining(p, a3, on)!.mode).toBe('anchorFixed');
  });

  it('a plain drill with its own teaching has three steps, success, a common error and easier/harder versions', () => {
    const t = resolveTraining(p, work('C6'), on)!;
    expect(t.mode).toBe('plain');
    expect(t.steps).toHaveLength(3);
    expect(t.success && t.commonError && t.easier && t.harder).toBeTruthy();
  });

  it("C6's main measure is not the V-pull count; F7 no longer claims to read a defender", () => {
    expect(p.focusMetricConfig.C6.primary).not.toContain('M4');
    expect(p.focusMetricConfig.F7.primary).not.toContain('correctResponseByDefenderAction');
  });

  it('validation rejects unknown teaching modes, unknown measures and defender drills without 3D teaching', () => {
    const bad = structuredClone(p);
    (bad.drills.find((d) => d.id === 'C6')!.teach as Record<string, unknown>).mystery = bad.drills.find((d) => d.id === 'C6')!.teach!.plain;
    bad.focusMetricConfig.C6.supporting.push('madeUpMeasure');
    delete bad.drills.find((d) => d.id === 'F6')!.teach!.defender3d;
    const r = validateProgramme(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('unknown teaching mode "mystery"'))).toBe(true);
      expect(r.errors.some((e) => e.includes('unknown measure "madeUpMeasure"'))).toBe(true);
      expect(r.errors.some((e) => e.includes('F6: runs with the 3D defender but has no "defender3d" teaching'))).toBe(true);
    }
  });
});
