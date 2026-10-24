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

// Item 4: with the camera on, a work block needs movement in the drill area for 70% of it.
export const MIN_PRESENCE_FRACTION = 0.7;

export function blockRanFully(r: BlockResult): boolean {
  if (r.skipped) return false;
  if (r.presenceFrac !== undefined && r.presenceFrac < MIN_PRESENCE_FRACTION) return false;
  if (r.ranToEnd) return true;
  return r.mode === 'reps' && r.doneEarly && r.elapsedS >= REPS_DONE_MIN_FRACTION * r.plannedS;
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
      if (!attemptsFor(i).some(blockRanFully)) reasons.push(`${label} skipped`);
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
