import type { BlockResult, Pause, SessionStatus } from '../db/types';
import type { RunBlock } from './plans';

// "Fully completed" (plan/14 §14.6). These thresholds are rules, so they live in code.
export const REPS_DONE_MIN_FRACTION = 0.8;
export const MAX_TOTAL_PAUSE_FRACTION = 0.25;
export const MAX_SINGLE_PAUSE_S = 5 * 60;

export interface CompletionInput {
  plan: RunBlock[];
  results: BlockResult[];
  pauses: Pause[];
  sessionLengthS: number;
  stopped: boolean;
  /** Plan indexes of benchmark blocks that have a logged result. */
  benchmarksLogged: Set<number>;
  /** For multi-area runs: judge only this part's work and benchmark blocks. */
  partIndex?: number;
}

export interface CompletionOutcome {
  status: SessionStatus;
  reasons: string[];
}

// Item 4: with the camera on, a work block needs movement in the drill area for 70% of it. This is a
// motion-based activity check (pixel change in the marked area), not a person detector (Brief R03); the
// credit rule stays as it is until the owner decides, but a block it could not confirm is reported as a
// camera check, never as a skipped block.
export const MIN_PRESENCE_FRACTION = 0.7;

const ranItsTime = (r: BlockResult) => r.ranToEnd || (r.mode === 'reps' && r.doneEarly && r.elapsedS >= REPS_DONE_MIN_FRACTION * r.plannedS);
const activityNotConfirmed = (r: BlockResult) => r.presenceFrac !== undefined && r.presenceFrac < MIN_PRESENCE_FRACTION && !r.activityConfirmedBy;

/** Blocks that ran their time but the camera's activity check could not confirm (and nobody has yet). */
export const unconfirmedBlocks = (results: BlockResult[]) => results.filter((r) => !r.skipped && !r.practice && ranItsTime(r) && activityNotConfirmed(r));

/** The same blocks, as if the player confirmed them. */
export const withPlayerConfirmation = (results: BlockResult[], at: string): BlockResult[] =>
  results.map((r) => (unconfirmedBlocks([r]).length ? { ...r, activityConfirmedBy: 'player' as const, activityConfirmedAt: at } : r));

export function blockRanFully(r: BlockResult): boolean {
  if (r.skipped || r.practice) return false;
  if (activityNotConfirmed(r)) return false;
  return ranItsTime(r);
}

/** The camera's activity check for a block: what it observed, kept apart from the completion decision. */
export type ActivityCheck = 'confirmed' | 'notConfirmed' | 'unavailable' | 'cameraMoved';
export function activityCheckFor(presenceFrac: number | undefined, cameraMoved: boolean): ActivityCheck {
  if (cameraMoved) return 'cameraMoved';
  if (presenceFrac === undefined) return 'unavailable';
  return presenceFrac < MIN_PRESENCE_FRACTION ? 'notConfirmed' : 'confirmed';
}

/** Minutes of practice actually done (every block that ran, whatever its outcome). */
export function practiceMinutes(results: BlockResult[]): number {
  return Math.round(results.filter((r) => !r.skipped && !r.practice).reduce((t, r) => t + (r.elapsedS || 0), 0) / 60);
}

const minutesText = (s: number) => {
  const m = Math.round(s / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
};

export function pauseStats(pauses: Pause[]): { totalS: number; longestS: number } {
  let totalS = 0;
  let longestS = 0;
  for (const p of pauses) {
    const s = Math.max(0, (p.endMs - p.startMs) / 1000);
    totalS += s;
    longestS = Math.max(longestS, s);
  }
  return { totalS, longestS };
}

export function evaluateCompletion(input: CompletionInput): CompletionOutcome {
  const { plan, results, pauses, sessionLengthS, stopped, benchmarksLogged, partIndex } = input;
  if (stopped) return { status: 'stopped', reasons: ['stopped'] };

  const reasons: string[] = [];
  const inPart = (b: RunBlock) => partIndex === undefined || b.partIndex === partIndex;
  const attemptsFor = (i: number) => results.filter((r) => r.index === i);

  plan.forEach((b, i) => {
    const label = `block ${i + 1}`;
    if (b.kind === 'warmup') {
      if (!attemptsFor(i).some(blockRanFully)) reasons.push('warm-up not finished');
    } else if (b.kind === 'work' && inPart(b)) {
      const tries = attemptsFor(i);
      if (tries.some(blockRanFully)) return;
      // Ran its time, but the camera's activity check could not confirm it: a technical reason.
      const unconfirmed = tries.find((r) => !r.skipped && !r.practice && ranItsTime(r) && activityNotConfirmed(r));
      reasons.push(unconfirmed ? `${label}: camera activity check could not confirm it` : `${label} skipped`);
    }
  });

  const { totalS, longestS } = pauseStats(pauses);
  if (totalS >= MAX_TOTAL_PAUSE_FRACTION * sessionLengthS) reasons.push(`paused ${minutesText(totalS)}`);
  else if (longestS > MAX_SINGLE_PAUSE_S) reasons.push(`one pause of ${minutesText(longestS)}`);

  if (reasons.length) return { status: 'partial', reasons };

  const benchmarkIdx = plan.map((b, i) => (b.kind === 'benchmark' && inPart(b) ? i : -1)).filter((i) => i >= 0);
  const skippedBenchmark = benchmarkIdx.some((i) => !benchmarksLogged.has(i));
  return skippedBenchmark ? { status: 'completedBenchmarkSkipped', reasons: ['benchmark skipped'] } : { status: 'completed', reasons: [] };
}

export const isCompletedStatus = (s: SessionStatus) => s === 'completed' || s === 'completedBenchmarkSkipped';
