import { describe, expect, it } from 'vitest';
import type { LearningExample, ModelVersion } from '../db/types';
import { acceptExample, activate, activeVersion, freezeValidation, proposeCandidate, rollback, UnverifiedExampleError } from './service';

/** Verified labels where the true cut on "shift" is 0.3 (the base model uses 0.5). */
const ex = (i: number, over: Partial<LearningExample> = {}): LearningExample => {
  const shift = (i % 20) / 20;
  return { id: `e${String(i).padStart(3, '0')}`, component: 'feintExecution', createdAt: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`, features: { shift }, label: shift >= 0.3 ? 'yes' : 'no', labelSource: 'flaggedRepReview', verified: true, context: { layoutVersion: 1, lighting: i % 2 ? 'day' : 'lamp' }, inValidationSet: false, ...over };
};
const base = { feature: 'shift', threshold: 0.5, direction: 1 as const };

describe('learning service (part 18)', () => {
  it('an unverified example can never enter a training set', () => {
    expect(() => acceptExample(ex(1, { verified: false }))).toThrow(UnverifiedExampleError);
    expect(() => acceptExample(ex(1, { labelSource: undefined }))).toThrow(UnverifiedExampleError);
    expect(acceptExample(ex(1)).id).toBe('e001');
  });

  it('a candidate is activated only when it beats the active model on the frozen set', () => {
    const exs = Array.from({ length: 60 }, (_, i) => ex(i));
    const val = freezeValidation(exs, 'feintExecution', '2026-12-01')!;
    expect(val.exampleIds.length).toBe(20);
    const r = proposeCandidate({ component: 'feintExecution', feature: 'shift', base, examples: exs, validation: val, versions: [], now: '2026-12-02' })!;
    expect(r.candidate.status).toBe('active');
    expect(r.candidate.heldOutAccuracy!).toBeGreaterThan(r.candidate.baseAccuracy!);
    // A second candidate on the same data does not beat the first: rejected, the first stays active.
    const v1 = activate([], r.candidate);
    const r2 = proposeCandidate({ component: 'feintExecution', feature: 'shift', base, examples: exs, validation: val, versions: v1, now: '2026-12-03' })!;
    expect(r2.candidate.status).toBe('rejected');
    expect(activeVersion(activate(v1, r2.candidate), 'feintExecution')?.id).toBe(r.candidate.id);
  });

  it('noisy unverified examples do not change what is learned', () => {
    const exs = Array.from({ length: 60 }, (_, i) => ex(i));
    const noise = Array.from({ length: 40 }, (_, i) => ex(100 + i, { verified: false, label: 'yes', features: { shift: 0 } }));
    const val = freezeValidation(exs, 'feintExecution', '2026-12-01')!;
    const a = proposeCandidate({ component: 'feintExecution', feature: 'shift', base, examples: exs, validation: val, versions: [], now: 'x' })!;
    const b = proposeCandidate({ component: 'feintExecution', feature: 'shift', base, examples: [...exs, ...noise], validation: val, versions: [], now: 'x' })!;
    expect(b.candidate.params).toEqual(a.candidate.params);
  });

  it('rollback restores the previous model; scores keep the version that produced them', () => {
    const v = (n: number, status: ModelVersion['status']): ModelVersion => ({ id: `feintExecution@${n}`, component: 'feintExecution', n, createdAt: '', kind: 'personalised', params: { threshold: n / 10, direction: 1 }, examplesUsed: 10, status });
    const versions = [v(1, 'retired'), v(2, 'active')];
    const back = rollback(versions, 'feintExecution');
    expect(activeVersion(back, 'feintExecution')?.id).toBe('feintExecution@1');
    expect(back.find((x) => x.n === 2)?.status).toBe('rejected');
    expect(back).toHaveLength(2); // nothing deleted
  });

  it('pause and reset: paused learns nothing; reset ignores earlier examples without deleting them', () => {
    const exs = Array.from({ length: 60 }, (_, i) => ex(i));
    const val = freezeValidation(exs, 'feintExecution', '2026-12-01')!;
    expect(proposeCandidate({ component: 'feintExecution', feature: 'shift', base, examples: exs, validation: val, versions: [], settings: { id: 'main', paused: true, components: {} }, now: 'x' })).toBeNull();
    expect(proposeCandidate({ component: 'feintExecution', feature: 'shift', base, examples: exs, validation: val, versions: [], settings: { id: 'main', paused: false, components: { feintExecution: { paused: false, resetAt: '2026-12-31' } } }, now: 'x' })).toBeNull();
    expect(exs).toHaveLength(60);
  });
});

describe('applying personalised models (part 18)', () => {
  it('uses only active personalised models, when learning is on and not paused, and names them', async () => {
    const { personalisedThresholds, modelVersionLabel } = await import('./service');
    const v = (id: string, component: 'feintExecution' | 'scanPattern', status: 'active' | 'retired', note: string, threshold: number, direction = 1) =>
      ({ id, component, n: Number(id.split('@')[1]), createdAt: '', kind: 'personalised', params: { threshold, direction }, note, status }) as never;
    const versions = [v('feintExecution@1', 'feintExecution', 'retired', 'fakeShift', 0.1), v('feintExecution@2', 'feintExecution', 'active', 'fakeShift', 0.15), v('scanPattern@1', 'scanPattern', 'active', 'headTurn', 0.3)];
    const on = personalisedThresholds(versions, { id: 'main', paused: false, components: {} } as never, true);
    expect(on.thresholds).toEqual({ fakeMinHipWidths: 0.15, lookShoulderWidths: 0.3 });
    expect(modelVersionLabel(on.modelVersions)).toBe('rules-1+feintExecution@2+scanPattern@1');
    expect(personalisedThresholds(versions, { id: 'main', paused: true, components: {} } as never, true).modelVersions).toEqual([]);
    expect(personalisedThresholds(versions, undefined, false).modelVersions).toEqual([]);
    expect(personalisedThresholds(versions, { id: 'main', paused: false, components: { scanPattern: { paused: true } } } as never, true).thresholds).toEqual({ fakeMinHipWidths: 0.15 });
    // A model pointing the other way is not applied.
    expect(personalisedThresholds([v('scanPattern@2', 'scanPattern', 'active', 'headTurn', 0.3, -1)], undefined, true).modelVersions).toEqual([]);
    expect(modelVersionLabel([])).toBe('rules-1');
  });
});
