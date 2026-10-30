import type { RepAnalysis } from '../analysis/types';
import type { CueLogEntry } from '../cue/engine';
import type { LearningExample } from '../db/types';
import { chanceTail } from '../domain/chance';

// Head-turn labels from what the player did (owner decision 2026-10-30). A parent cannot review every
// scanning rep, so the drills themselves supply evidence of a look, paired with the camera's measured
// head turn for that rep:
//  - call-out: the number shown behind the player was called correctly (1 chance in 9 by guessing) →
//    "looked", label source callOut. A wrong or unheard call is left out (speech can mishear).
//  - right move: on a cue shown behind the player, the right decision → "looked", the wrong one →
//    "did not look", label source taskOutcome. Without seeing the cue, a right move is a guess that comes
//    off 1 time in k (50/50 for two choices). So a block is used only when its accuracy is very unlikely
//    by luck alone (binomial chance below 5%), and each right move counts only by the chance it was a
//    real read rather than a lucky guess, estimated from the block's accuracy (see readingVsLuck).
//    Catch trials (no cue) are left out.
// A parent's own review of a rep always takes its place. The learning gate is unchanged: a new threshold
// is used only if it does better on sessions it never learned from.

/** A block's right moves are used only when luck alone would reach that score less often than this. */
export const MAX_LUCK_CHANCE = 0.05;

export interface ReadingVsLuck {
  /** Right by guessing on any one rep: 1 / number of choices. */
  guessRate: number;
  /** Right answers luck alone would give on average in this block. */
  expectedByLuck: number;
  /** Chance that guessing alone reaches this many right answers or more. */
  luckChance: number;
  /** Estimated share of reps where the player really read the cue: (accuracy − guess) / (1 − guess). */
  readShare: number;
  /** Chance a right move was a real read rather than a lucky guess. */
  rightWasRead: number;
  reading: boolean;
}

/** Was this block's accuracy reading or luck? k = number of possible cues (2 for a 50/50 drill). */
export function readingVsLuck(correct: number, n: number, k: number): ReadingVsLuck {
  const g = 1 / k;
  const acc = n ? correct / n : 0;
  const readShare = Math.max(0, Math.min(1, (acc - g) / (1 - g)));
  const luckChance = chanceTail(correct, n, k);
  const rightWasRead = readShare + (1 - readShare) * g > 0 ? readShare / (readShare + (1 - readShare) * g) : 0;
  return { guessRate: g, expectedByLuck: n * g, luckChance, readShare, rightWasRead, reading: luckChance < MAX_LUCK_CHANCE };
}

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
  const rl = readingVsLuck(judged.filter((r) => r.decisionCorrect).length, judged.length, i.cueValues);
  const decisionsUsable = i.cueValues > 1 && rl.reading;
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
      // A right move counts by the chance it was a read; a wrong move is taken as no look (a misread after
      // a real look is not separated from it).
      out.push({ ...base, label: r.decisionCorrect ? 'yes' : 'no', labelSource: 'taskOutcome', weight: r.decisionCorrect ? Math.round(rl.rightWasRead * 100) / 100 : 1 });
    }
  }
  return out;
}
