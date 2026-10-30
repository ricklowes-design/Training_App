import type { LearningComponent, LearningExample, LearningSettings, ModelVersion, ValidationDataset } from '../db/types';

// Continuous learning (part 18, tasks 7.1–7.3). Statistical heads only (a threshold on a
// feature), trained off the live path. Labels come only from independently verified
// examples; a candidate is activated only if it beats the active model on a frozen
// validation set; earlier models are kept so rollback works; history is never re-scored.

export const MIN_VALIDATION = 10;
export const MIN_TRAINING = 12;
export const MAX_GROUP_DROP = 0.1;

export class UnverifiedExampleError extends Error {}

/** Only verified labels (flagged-rep review, blind calibration, coach) may enter learning. */
export function acceptExample(ex: LearningExample): LearningExample {
  if (!ex.verified || !ex.labelSource || ex.label === undefined) throw new UnverifiedExampleError('Only independently verified examples can be used for learning.');
  return ex;
}

const usable = (ex: LearningExample, s?: LearningSettings) => {
  const reset = s?.components[ex.component]?.resetAt;
  return ex.verified && ex.label !== undefined && (!reset || ex.createdAt > reset);
};

/** The recording an example came from: examples from one session never sit on both sides of a split (Brief R11). */
const sessionOf = (e: LearningExample) => e.sessionRecordId ?? `example:${e.id}`;

/** Freezes a representative validation set once: every third recorded session (oldest first), with all
 *  of that session's verified examples, so reps from one session cannot be split between training and
 *  evaluation (Brief R11; was every third example). */
export function freezeValidation(examples: LearningExample[], component: LearningComponent, now: string): ValidationDataset | null {
  const pool = examples.filter((e) => e.component === component && e.verified && e.label !== undefined).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const sessions = [...new Set(pool.map(sessionOf))];
  const held = new Set(sessions.filter((_, i) => i % 3 === 2));
  const picked = pool.filter((e) => held.has(sessionOf(e)));
  if (picked.length < MIN_VALIDATION) return null;
  return { id: component, component, frozenAt: now, exampleIds: picked.map((e) => e.id) };
}

export interface ThresholdModel {
  feature: string;
  threshold: number;
  /** 1: label "yes" when feature >= threshold; -1: when below. */
  direction: 1 | -1;
}

export const predict = (m: ThresholdModel, ex: LearningExample) => {
  const v = ex.features[m.feature];
  if (v === undefined) return undefined;
  return (m.direction === 1 ? v >= m.threshold : v < m.threshold) ? 'yes' : 'no';
};

/** Share of examples the model gives an answer for. */
export function coverage(m: ThresholdModel, exs: LearningExample[]): number {
  return exs.length ? exs.filter((e) => predict(m, e) !== undefined).length / exs.length : 0;
}

/** Weighted share of examples the model gets right (an example counts by its weight, default 1). */
export function accuracy(m: ThresholdModel, exs: LearningExample[]): number {
  const judged = exs.filter((e) => predict(m, e) !== undefined);
  const w = (e: LearningExample) => e.weight ?? 1;
  const total = judged.reduce((t, e) => t + w(e), 0);
  return total ? judged.filter((e) => predict(m, e) === e.label).reduce((t, e) => t + w(e), 0) / total : 0;
}

/** The threshold on one feature that best separates the verified labels. */
export function fitThreshold(exs: LearningExample[], feature: string): ThresholdModel {
  const vals = [...new Set(exs.map((e) => e.features[feature]).filter((v): v is number => v !== undefined))].sort((a, b) => a - b);
  let best: ThresholdModel = { feature, threshold: vals[0] ?? 0, direction: 1 };
  let bestAcc = -1;
  for (const t of vals) {
    for (const direction of [1, -1] as const) {
      const m = { feature, threshold: t, direction };
      const a = accuracy(m, exs);
      if (a > bestAcc) {
        bestAcc = a;
        best = m;
      }
    }
  }
  return best;
}

export const toModel = (v: ModelVersion): ThresholdModel => ({ feature: String(v.note ?? ''), threshold: v.params.threshold, direction: v.params.direction === -1 ? -1 : 1 });

export function activeVersion(versions: ModelVersion[], component: LearningComponent): ModelVersion | undefined {
  return versions.filter((v) => v.component === component && v.status === 'active').sort((a, b) => b.n - a.n)[0];
}

export interface CandidateResult {
  candidate: ModelVersion;
  reason: string;
}

/**
 * Trains a candidate on the verified, non-validation examples and gates it on the frozen set:
 * activated only if its held-out accuracy beats the active (or base) model, and no context group
 * (layout or lighting) drops by more than MAX_GROUP_DROP.
 */
export function proposeCandidate(args: {
  component: LearningComponent;
  feature: string;
  base: ThresholdModel;
  examples: LearningExample[];
  validation: ValidationDataset | undefined;
  versions: ModelVersion[];
  settings?: LearningSettings;
  now: string;
}): CandidateResult | null {
  const { component, feature, base, examples, validation, versions, settings, now } = args;
  if (settings?.paused || settings?.components[component]?.paused) return null;
  if (!validation) return null;
  const valIds = new Set(validation.exampleIds);
  const own = examples.filter((e) => e.component === component && usable(e, settings));
  const val = examples.filter((e) => valIds.has(e.id));
  // No example from a held-out session trains, even one added after the set was frozen.
  const valSessions = new Set(val.map(sessionOf));
  const train = own.filter((e) => !valIds.has(e.id) && !valSessions.has(sessionOf(e)));
  if (train.length < MIN_TRAINING || val.length < MIN_VALIDATION) return null;
  const m = fitThreshold(train, feature);
  const current = activeVersion(versions, component);
  const ref = current ? toModel(current) : base;
  // Both models are compared on the same examples, those both can judge; a candidate that answers
  // fewer examples than the reference is reported as coverage loss, never as a win.
  const both = val.filter((e) => predict(m, e) !== undefined && predict(ref, e) !== undefined);
  const acc = accuracy(m, both);
  const refAcc = accuracy(ref, both);
  const coverageLoss = coverage(m, val) < coverage(ref, val);
  // Generalisation across sessions, lighting and layouts.
  const groups = new Map<string, LearningExample[]>();
  for (const e of val) {
    const k = `${e.context.layoutVersion ?? '?'}|${e.context.lighting ?? '?'}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const worstDrop = Math.max(0, ...[...groups.values()].filter((g) => g.length >= 3).map((g) => accuracy(ref, g) - accuracy(m, g)));
  const n = Math.max(0, ...versions.filter((v) => v.component === component).map((v) => v.n)) + 1;
  const better = acc > refAcc && worstDrop <= MAX_GROUP_DROP && !coverageLoss;
  return {
    candidate: {
      id: `${component}@${n}`,
      component,
      n,
      createdAt: now,
      kind: 'personalised',
      params: { threshold: m.threshold, direction: m.direction },
      note: feature,
      heldOutAccuracy: Math.round(acc * 1000) / 1000,
      baseAccuracy: Math.round(refAcc * 1000) / 1000,
      examplesUsed: train.length,
      status: better ? 'active' : 'rejected',
      activatedAt: better ? now : undefined,
    },
    reason: better
      ? `held-out ${Math.round(acc * 100)}% vs ${Math.round(refAcc * 100)}%`
      : coverageLoss
        ? `coverage loss: answers ${Math.round(coverage(m, val) * 100)}% of held-out examples, the current model ${Math.round(coverage(ref, val) * 100)}%`
        : worstDrop > MAX_GROUP_DROP
          ? `worse by ${Math.round(worstDrop * 100)} points in one lighting/layout group`
          : `held-out ${Math.round(acc * 100)}% did not beat ${Math.round(refAcc * 100)}%`,
  };
}

/** Applies an accepted candidate: the previous active version is retired but kept. */
export function activate(versions: ModelVersion[], cand: ModelVersion): ModelVersion[] {
  if (cand.status !== 'active') return [...versions, cand];
  return [...versions.map((v) => (v.component === cand.component && v.status === 'active' ? { ...v, status: 'retired' as const } : v)), cand];
}

/** Rollback: the active version is rejected and the most recent retired one comes back (or the base). */
export function rollback(versions: ModelVersion[], component: LearningComponent): ModelVersion[] {
  const cur = activeVersion(versions, component);
  if (!cur) return versions;
  const prev = versions.filter((v) => v.component === component && v.status === 'retired' && v.n < cur.n).sort((a, b) => b.n - a.n)[0];
  return versions.map((v) => (v.id === cur.id ? { ...v, status: 'rejected' as const } : prev && v.id === prev.id ? { ...v, status: 'active' as const } : v));
}

/** Which analysis threshold each component's model sets, by its feature (only models that point the expected way). */
const APPLIES: Partial<Record<LearningComponent, { feature: string; key: 'fakeMinHipWidths' | 'lookShoulderWidths' }>> = {
  feintExecution: { feature: 'fakeShift', key: 'fakeMinHipWidths' },
  scanPattern: { feature: 'headTurn', key: 'lookShoulderWidths' },
};

/**
 * The thresholds the after-block analysis uses from active, validated personalised models, and their version
 * ids to store with every score they produce (part 18). Nothing when personalisation is off or paused, for a
 * paused component, or for a model whose feature or direction is not the one the analysis uses.
 */
export function personalisedThresholds(
  versions: ModelVersion[],
  ls: LearningSettings | undefined,
  learningOn: boolean,
): { thresholds: Partial<Record<'fakeMinHipWidths' | 'lookShoulderWidths', number>>; modelVersions: string[] } {
  const out = { thresholds: {} as Partial<Record<'fakeMinHipWidths' | 'lookShoulderWidths', number>>, modelVersions: [] as string[] };
  if (!learningOn || ls?.paused) return out;
  for (const [component, a] of Object.entries(APPLIES) as [LearningComponent, { feature: string; key: 'fakeMinHipWidths' | 'lookShoulderWidths' }][]) {
    if (ls?.components[component]?.paused) continue;
    const v = activeVersion(versions, component);
    if (!v || v.kind !== 'personalised') continue;
    const m = toModel(v);
    if (m.feature !== a.feature || m.direction !== 1) continue;
    out.thresholds[a.key] = m.threshold;
    out.modelVersions.push(v.id);
  }
  return out;
}

/** The model-version label for a result's comparison context: the base rules plus any personalised models used. */
export const modelVersionLabel = (ids: string[]) => ['rules-1', ...[...ids].sort()].join('+');
