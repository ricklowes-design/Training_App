import type { Programme } from '../content/types';
import { db } from '../db/db';
import type { CameraSetup, DrillFamily } from '../db/types';
import type { RunBlock } from '../domain/plans';
import { familyOf } from './session';

/** Which camera set-up a block uses: the current one for its drill family. */
export function familyForBlock(p: Programme, b: RunBlock): DrillFamily | undefined {
  if (b.kind === 'work') return familyOf(p.drills.find((d) => d.id === b.drillId)?.layoutId);
  if (b.kind === 'anchor') return familyOf(p.anchors.find((a) => a.id === b.anchorId)?.layoutId);
  if (b.kind === 'benchmark' && b.benchmarkId) return familyOf(p.benchmarkLayouts?.[b.benchmarkId]);
  return undefined;
}

export function currentSetup(setups: CameraSetup[], family: DrillFamily | undefined): CameraSetup | undefined {
  if (!family) return undefined;
  return setups.filter((s) => s.drillFamily === family && !s.retiredAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Deletes clips older than the retention period unless marked to keep (plan/08 §8.6). */
export async function pruneClips(retentionDays: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const old = await db.clips.where('date').below(cutoff).filter((c) => !c.keep).primaryKeys();
  if (old.length) {
    await db.clips.bulkDelete(old);
    await db.repAnalyses.where('clipId').anyOf(old).delete();
    await db.blockAnalyses.where('clipId').anyOf(old).delete();
  }
  return old.length;
}
