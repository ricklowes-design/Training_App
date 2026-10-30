import type { BenchmarkResult, BenchmarkValues, ScoreSupport } from '../db/types';
import { resultLines } from './metrics';

// What backs a score the player entered (owner decision 2026-10-30). A parent cannot watch every test,
// so a player's score is relied on when the other evidence agrees with it, and is counted but marked for
// a parent to check (with the test's video kept) when it doesn't, or when there is nothing to go on.
// Worked out once when the result is saved and stored with it; never re-scored later.
//
// The evidence, each used only when available:
//  1. the camera's own count for this block;
//  2. the best earlier result on the same test under the same conditions;
//  3. the camera's decision accuracy in recent practice of the same drill (decision tests).
// Any one that disagrees → check. At least one that agrees and none that disagrees → strong.
// The step sizes below are a first rule, listed for the owner to review against real results.

/** Agreement with the camera's count: within one rep. */
export const CAMERA_TOLERANCE = 1;
/** Better than the best earlier result by more than this share (and at least one point) → check. */
export const HISTORY_STEP = 0.1;
/** Decision share above recent practice accuracy by more than this → check. */
export const PRACTICE_MARGIN = 0.2;

const OUT_OF: Record<string, number> = { SB: 10, A4: 10, A3: 16 };

export function decisionShare(v: BenchmarkValues): number | undefined {
  if (v.kind === 'CA' || v.kind === 'QUIZ') return v.outOf ? v.correct / v.outOf : undefined;
  if (v.kind === 'SB' || v.kind === 'A4' || v.kind === 'A3') return v.correct / OUT_OF[v.kind];
  return undefined;
}

export interface SupportInput {
  claimed: BenchmarkValues;
  cameraEstimate?: { correct?: number };
  /** Earlier results on this test that compare with this one, and that can be trusted. */
  history: BenchmarkResult[];
  /** Camera decision accuracy (0–1) of recent practice blocks of this test's drill. */
  practiceAccuracy: number[];
}

export function supportFor(i: SupportInput): ScoreSupport {
  const agree: string[] = [];
  const disagree: string[] = [];
  const claimedCorrect = 'correct' in i.claimed ? i.claimed.correct : undefined;

  // 1. The camera's count for this block.
  if (i.cameraEstimate?.correct !== undefined && claimedCorrect !== undefined) {
    if (Math.abs(claimedCorrect - i.cameraEstimate.correct) <= CAMERA_TOLERANCE) agree.push(`the camera's count (${i.cameraEstimate.correct})`);
    else disagree.push(`the camera counted ${i.cameraEstimate.correct}, the player ${claimedCorrect}`);
  }

  // 2. Every line against the best earlier result for that line.
  if (i.history.length) {
    let consistent = true;
    for (const l of resultLines(i.claimed)) {
      const earlier = i.history.flatMap((r) => resultLines(r.values).filter((x) => x.key === l.key));
      if (l.score !== undefined) {
        const best = Math.max(...earlier.map((x) => x.score ?? -Infinity));
        if (Number.isFinite(best) && l.score > best + Math.max(1, Math.round(HISTORY_STEP * best))) {
          consistent = false;
          disagree.push(`${l.label} ${l.text} is well above the best before (${best})`);
        }
      } else if (l.timeS !== undefined) {
        const best = Math.min(...earlier.map((x) => x.timeS ?? Infinity));
        if (Number.isFinite(best) && l.timeS < best * (1 - HISTORY_STEP)) {
          consistent = false;
          disagree.push(`${l.label} ${l.text} is well faster than the best before (${best.toFixed(1)} s)`);
        }
      }
    }
    if (consistent) agree.push(`earlier results on this test (${i.history.length})`);
  }

  // 3. Recent practice of the same drill, as the camera judged it.
  const share = decisionShare(i.claimed);
  if (share !== undefined && i.practiceAccuracy.length) {
    const mean = i.practiceAccuracy.reduce((a, b) => a + b, 0) / i.practiceAccuracy.length;
    if (share <= mean + PRACTICE_MARGIN) agree.push(`recent practice (${Math.round(mean * 100)}% right on camera)`);
    else disagree.push(`recent practice was ${Math.round(mean * 100)}% right on camera`);
  }

  if (disagree.length) return { method: 'support-1', level: 'check', reasons: disagree };
  if (agree.length) return { method: 'support-1', level: 'strong', reasons: agree };
  return { method: 'support-1', level: 'check', reasons: ['nothing else to compare with yet'] };
}
