import { APP_VERSION } from '../app/data';
import { db } from '../db/db';
import type { BenchmarkResult, BenchmarkValues, Conditions, SessionRecord, Settings, SwitchSnapshot } from '../db/types';
import { evaluateCompletion, unconfirmedBlocks, withPlayerConfirmation } from '../domain/completion';
import { evidenceOk } from '../domain/advancement';
import { comparability } from '../domain/comparability';
import { supportFor } from '../domain/support';
import type { RunPlan } from '../domain/plans';
import type { RunState } from './engine';

// Records are created when the run starts (status partial, "not finished") and
// updated after every block, so a closed tab still leaves an honest partial record.

export interface RunIds {
  runId: string;
  recordIds: string[]; // one per plan part
}

export function partMinutes(plan: RunPlan, partIndex: number): number {
  const own = plan.blocks.filter((b) => b.partIndex === partIndex && plan.parts.length > 1).reduce((t, b) => t + b.minutes, 0);
  if (plan.parts.length === 1) return plan.totalMinutes;
  const shared = plan.blocks.filter((b) => b.partIndex === undefined).reduce((t, b) => t + b.minutes, 0);
  return own + shared / plan.parts.length;
}

export const switchSnapshot = (s: Settings): SwitchSnapshot => ({
  at: new Date().toISOString(),
  flags: { ...s.flags },
  cueEngine: s.cueEngine,
  cameraOn: s.camera.enabled,
  pose: s.camera.pose,
  analysisFps: s.camera.analysisFps,
  wallMic: s.sound.wallMic !== false,
  speech: s.sound.speech,
  tones: s.sound.tones,
});

export async function createRun(plan: RunPlan, trial: boolean, ctx: { contentVersion: string; layoutVersion: number; roomProfileId?: string; roomProfileVersion?: number; switches?: SwitchSnapshot }): Promise<RunIds> {
  const runId = crypto.randomUUID();
  const date = new Date().toISOString();
  const records: SessionRecord[] = plan.parts.map((part, i) => ({
    id: crypto.randomUUID(),
    runId,
    kind: part.kind,
    areaId: part.areaId,
    sessionNumber: part.sessionNumber,
    sessionId: part.sessionId,
    date,
    status: 'partial',
    reasons: ['not finished'],
    plannedMinutes: partMinutes(plan, i),
    blocks: [],
    pauses: [],
    trial,
    light: plan.light,
    partner: plan.partner,
    appVersion: APP_VERSION,
    contentVersion: ctx.contentVersion,
    layoutVersion: ctx.layoutVersion,
    roomProfileId: ctx.roomProfileId,
    roomProfileVersion: ctx.roomProfileVersion,
    switches: ctx.switches,
  }));
  await db.sessionRecords.bulkPut(records);
  return { runId, recordIds: records.map((r) => r.id) };
}

/** Which record a block belongs to. Shared blocks (warm-up, rests) go to the first part. */
export function recordIdForBlock(plan: RunPlan, ids: RunIds, blockIdx: number): string {
  const part = plan.blocks[blockIdx]?.partIndex ?? 0;
  return ids.recordIds[Math.min(part, ids.recordIds.length - 1)];
}

export async function saveProgress(state: RunState, ids: RunIds, benchmarksLogged: Set<number>, final: boolean): Promise<SessionRecord[]> {
  const { plan } = state;
  const multi = plan.parts.length > 1;
  const out: SessionRecord[] = [];
  // Browser tests only (navigator.webdriver): fail the next final save once, to check the retry card.
  const w = typeof window !== 'undefined' ? (window as unknown as { __failNextFinalSave?: boolean }) : undefined;
  if (final && typeof navigator !== 'undefined' && navigator.webdriver && w?.__failNextFinalSave) {
    w.__failNextFinalSave = false;
    throw new Error('test: save failed');
  }
  await db.transaction('rw', db.sessionRecords, async () => {
    for (let i = 0; i < ids.recordIds.length; i++) {
      const rec = await db.sessionRecords.get(ids.recordIds[i]);
      if (!rec) continue;
      const blocks = state.results.filter((r) => !multi || plan.blocks[r.index].partIndex === undefined || plan.blocks[r.index].partIndex === i);
      let status = rec.status;
      let reasons = rec.reasons;
      let ifActivityConfirmed = rec.ifActivityConfirmed;
      if (final) {
        const judge = (results: typeof state.results) =>
          evaluateCompletion({
            plan: plan.blocks,
            results,
            pauses: state.pauses,
            sessionLengthS: plan.totalMinutes * 60,
            stopped: state.stopped,
            benchmarksLogged,
            partIndex: multi ? i : undefined,
          });
        const outcome = judge(state.results);
        status = outcome.status;
        reasons = outcome.reasons;
        // What the player's confirmation of camera-unconfirmed blocks would change (owner decision 2026-10-30).
        ifActivityConfirmed = unconfirmedBlocks(blocks).length ? judge(withPlayerConfirmation(state.results, '')) : undefined;
      }
      const updated: SessionRecord = { ...rec, blocks, pauses: state.pauses, status, reasons, ifActivityConfirmed, endedAt: final ? new Date().toISOString() : rec.endedAt };
      await db.sessionRecords.put(updated);
      out.push(updated);
    }
  });
  return out;
}

export async function saveBenchmark(args: {
  recordId: string;
  blockIndex: number;
  attempt: number;
  benchmarkId: string;
  areaId?: string;
  drillId?: string;
  conditions: Conditions;
  values: BenchmarkValues;
  prefilledFrom?: 'camera';
  cameraEstimate?: BenchmarkResult['cameraEstimate'];
  /** For a player-scored result: the evidence to weigh it against (owner decision 2026-10-30). */
  weigh?: { earlier: BenchmarkResult[]; practiceDrillId?: string };
}): Promise<BenchmarkResult> {
  const res: BenchmarkResult = {
    id: crypto.randomUUID(),
    sessionRecordId: args.recordId,
    blockIndex: args.blockIndex,
    attempt: args.attempt,
    date: new Date().toISOString(),
    benchmarkId: args.benchmarkId,
    areaId: args.areaId,
    drillId: args.drillId,
    conditions: args.conditions,
    values: args.values,
    ...(args.prefilledFrom ? { prefilledFrom: args.prefilledFrom } : {}),
    ...(args.cameraEstimate ? { cameraEstimate: args.cameraEstimate } : {}),
  };
  // The video of this test, when the camera recorded it.
  const clip = await db.clips
    .where('sessionRecordId')
    .equals(args.recordId)
    .filter((c) => c.blockIndex === args.blockIndex && c.attempt === args.attempt)
    .first()
    .catch(() => undefined);
  if (clip) res.clipId = clip.id;
  if (args.conditions.recordedBy === 'self' && args.weigh) {
    const history = args.weigh.earlier.filter((r) => r.benchmarkId === res.benchmarkId && r.id !== res.id && comparability(res, r).ok && evidenceOk(r));
    res.support = supportFor({ claimed: res.values, cameraEstimate: args.cameraEstimate, history, practiceAccuracy: await practiceAccuracy(args.weigh.practiceDrillId, args.recordId) });
    // A score to check keeps its video until a parent has looked (it is not pruned with old clips).
    if (res.support.level === 'check' && clip) await db.clips.update(clip.id, { keep: true });
  }
  await db.benchmarkResults.put(res);
  return res;
}

/** Camera decision accuracy of practice blocks of one drill in the last 28 days (other sessions). */
async function practiceAccuracy(drillId: string | undefined, recordId: string): Promise<number[]> {
  if (!drillId) return [];
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const clips = await db.clips.where('date').above(since).filter((c) => c.drillId === drillId && c.sessionRecordId !== recordId).toArray().catch(() => []);
  const rows = await db.blockAnalyses.bulkGet(clips.map((c) => c.id)).catch(() => []);
  return rows.map((r) => r?.data.accuracy).filter((x): x is number => x !== undefined && Number.isFinite(x));
}

export async function saveRoomCheck(ids: RunIds, roomCheck: NonNullable<SessionRecord['roomCheck']>): Promise<void> {
  await db.sessionRecords.where('id').anyOf(ids.recordIds).modify({ roomCheck });
}
