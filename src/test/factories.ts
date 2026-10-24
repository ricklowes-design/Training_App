import type { BenchmarkResult, BlockResult, SessionRecord } from '../db/types';
import type { RunPlan } from '../domain/plans';

let seq = 0;
export const id = () => `id-${++seq}`;

/** Block results for a plan where every block ran to its end. */
export function fullRun(plan: RunPlan): BlockResult[] {
  return plan.blocks.map((b, i) => ({
    index: i,
    kind: b.kind,
    attempt: 1,
    drillId: b.drillId,
    benchmarkId: b.benchmarkId,
    plannedS: b.minutes * 60,
    elapsedS: b.minutes * 60,
    ranToEnd: true,
    doneEarly: false,
    skipped: false,
    mode: b.mode,
  }));
}

export function rec(over: Partial<SessionRecord>): SessionRecord {
  return {
    id: id(),
    runId: id(),
    kind: 'programme',
    date: '2026-11-03T18:00:00.000Z',
    status: 'completed',
    reasons: [],
    plannedMinutes: 20,
    blocks: [],
    pauses: [],
    trial: false,
    appVersion: '0.1.0',
    contentVersion: '0.2.0',
    layoutVersion: 1,
    ...over,
  };
}

export function result(over: Partial<BenchmarkResult> & Pick<BenchmarkResult, 'values' | 'benchmarkId'>): BenchmarkResult {
  return {
    id: id(),
    sessionRecordId: 'r',
    blockIndex: 4,
    attempt: 1,
    date: '2026-11-04T18:00:00.000Z',
    conditions: { layoutVersion: 1, cueLevel: 'std', floor: 'hard', recorded: false, recordedBy: 'parent' },
    ...over,
  };
}
