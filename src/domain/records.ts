import type { BenchmarkResult, SessionRecord } from '../db/types';
import { isCompletedStatus, unconfirmedBlocks, withPlayerConfirmation } from './completion';

// What counts, and for what. These rules live in code (CLAUDE.md "Rules that must live in code").

/** A trial counts only once promoted; a demoted record no longer counts. */
export const isRecorded = (r: SessionRecord) => (!r.trial || !!r.promotedAt) && !r.demotedAt;

/** Unlocks only on completed / completedBenchmarkSkipped programme sessions that are recorded.
 *  A light session never unlocks: it has no test, so the same session stays next (owner decision
 *  2026-10-30). A demoted record keeps its unlock when a later record depended on it. */
export const countsForUnlock = (r: SessionRecord) =>
  r.kind === 'programme' && isCompletedStatus(r.status) && !r.light && (!r.trial || !!r.promotedAt) && (!r.demotedAt || !!r.unlockRetained);

/** Weekly totals: completed programme sessions only. Extras, anchors, baselines, partial, stopped and trials never count. */
export const countsForWeek = (r: SessionRecord) => r.kind === 'programme' && isCompletedStatus(r.status) && isRecorded(r);

/** A benchmark result counts for comparisons, criteria and milestones when its session is recorded,
 *  or when that one drill was kept from a trial. */
export function resultCounts(res: BenchmarkResult, rec: SessionRecord | undefined): boolean {
  if (!rec) return false;
  if (rec.demotedAt) return false;
  return isRecorded(rec) || !!res.keptAt;
}

export function countedResults(results: BenchmarkResult[], records: SessionRecord[]): BenchmarkResult[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return results.filter((res) => resultCounts(res, byId.get(res.sessionRecordId)));
}

/** The player confirms, after the session, the blocks the camera could not confirm (owner decision
 *  2026-10-30). Each block records that it was the player's word; the session takes the outcome worked
 *  out when it was saved, so no other rule (pauses, skipped blocks, trials) is bypassed. */
export function confirmActivity(rec: SessionRecord, now: Date): SessionRecord {
  if (!unconfirmedBlocks(rec.blocks).length || !rec.ifActivityConfirmed || rec.status === 'stopped') return rec;
  return { ...rec, blocks: withPlayerConfirmation(rec.blocks, now.toISOString()), status: rec.ifActivityConfirmed.status, reasons: rec.ifActivityConfirmed.reasons, ifActivityConfirmed: undefined };
}
