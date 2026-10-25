import type { BlockAnalysis, RepAnalysis } from './types';

// Camera estimates that may start an anchor or benchmark card (part 15 D10: only from the
// current block; the parent corrects and confirms). A count is filled only when the camera
// judged every rep: a partial count would read as a low score.

export interface CameraPrefill {
  values?: { correct?: number; early?: number; looks?: number };
  judged: number;
  of: number;
}

export const PREFILL_KINDS = ['A3', 'A4', 'SB'] as const;
export type PrefillKind = (typeof PREFILL_KINDS)[number];
const EXPECTED: Record<PrefillKind, number> = { A3: 16, A4: 10, SB: 10 };

export function cameraPrefill(kind: PrefillKind, a: BlockAnalysis | undefined, reps: RepAnalysis[]): CameraPrefill | null {
  if (!a) return null;
  const of = EXPECTED[kind];
  const judgedReps = reps.filter((r) => r.status === 'ok' && r.decisionCorrect !== undefined);
  const judged = judgedReps.length;
  if (reps.length !== of || judged !== of) return { judged, of };
  const correct = judgedReps.filter((r) => r.decisionCorrect).length;
  if (kind === 'A3') {
    const early = reps.some((r) => r.possibleEarlyRouteCommitment !== undefined) ? reps.filter((r) => !!r.possibleEarlyRouteCommitment).length : reps.filter((r) => r.preCueMovement).length;
    return { values: { correct, early }, judged, of };
  }
  if (kind === 'A4' && reps.every((r) => r.looksBeforeTouch !== undefined)) {
    return { values: { correct, looks: reps.filter((r) => (r.looksBeforeTouch ?? 0) > 0).length }, judged, of };
  }
  return { values: { correct }, judged, of };
}
