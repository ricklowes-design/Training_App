import type { RepAnalysis } from '../analysis/types';
import type { CueLogEntry } from '../cue/engine';
import type { LearningExample } from '../db/types';

// Head-turn labels from what the player did (owner decision 2026-10-30). A parent cannot review every
// scanning rep, so the drills themselves supply evidence of a look, paired with the camera's measured
// head turn for that rep:
//  - call-out: the number shown behind the player was called correctly (1 chance in 9 by guessing) →
//    "looked", label source callOut. A wrong or unheard call is left out (speech can mishear).
//  - right move: on a cue shown behind the player, the right decision → "looked", the wrong one →
//    "did not look", label source taskOutcome. Used only from blocks where the player was right at least
//    twice as often as guessing, so lucky guesses are a small share; one rep is weak evidence, many are
//    useful together. Catch trials (no cue) are left out.
// A parent's own review of a rep always takes its place. The learning gate is unchanged: a new threshold
// is used only if it does better on sessions it never learned from.

/** Right decisions needed in a block, as a multiple of the guessing rate, before its reps are used. */
export const OUTCOME_MIN_OVER_CHANCE = 2;

export interface OutcomeInput {
  clipId: string;
  sessionRecordId: string;
  date: string;
  layoutVersion?: number;
  /** Number of possible cue values (guessing rate 1/k); 0 when the cue is not shown behind the player. */
  cueValues: number;
  log: CueLogEntry[];
  reps: RepAnalysis[];
  callOuts?: { rep: number; shown: number; heard?: number }[];
  /** Reps a parent already reviewed (their answer wins). */
  reviewed: Set<number>;
}

export function outcomeExamples(i: OutcomeInput): LearningExample[] {
  const out: LearningExample[] = [];
  const judged = i.reps.filter((r) => r.status === 'ok' && r.decisionCorrect !== undefined && !i.log.find((e) => e.rep === r.repIndex)?.hidden);
  const accuracy = judged.length ? judged.filter((r) => r.decisionCorrect).length / judged.length : 0;
  const decisionsUsable = i.cueValues > 1 && judged.length >= 5 && accuracy >= Math.min(1, OUTCOME_MIN_OVER_CHANCE / i.cueValues);
  for (const r of i.reps) {
    if (r.status !== 'ok' || r.maxHeadTurn === undefined || i.reviewed.has(r.repIndex)) continue;
    const e = i.log.find((x) => x.rep === r.repIndex);
    if (!e || e.hidden) continue;
    const base = {
      id: `${i.clipId}:${r.repIndex}:outcome`,
      component: 'scanPattern' as const,
      createdAt: i.date,
      verified: true,
      sessionRecordId: i.sessionRecordId,
      context: { layoutVersion: i.layoutVersion },
      inValidationSet: false,
      features: { headTurn: r.maxHeadTurn, confidence: r.confidence },
    };
    const call = i.callOuts?.find((c) => c.rep === r.repIndex);
    if (call && call.heard !== undefined && call.heard === call.shown) {
      out.push({ ...base, label: 'yes', labelSource: 'callOut' });
    } else if (decisionsUsable && r.decisionCorrect !== undefined && !(call && call.heard !== undefined)) {
      out.push({ ...base, label: r.decisionCorrect ? 'yes' : 'no', labelSource: 'taskOutcome' });
    }
  }
  return out;
}
