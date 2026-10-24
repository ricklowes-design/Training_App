import type { Programme } from '../content/types';
import { db } from '../db/db';
import { computeMilestones } from './milestones';

/** Stores newly reached milestones (each id once). They are shown once on the home screen. */
export async function recordMilestones(p: Programme): Promise<void> {
  const [records, results, advancements, transfers, existing] = await Promise.all([
    db.sessionRecords.toArray(),
    db.benchmarkResults.toArray(),
    db.advancements.toArray(),
    db.transferObs.toArray(),
    db.milestones.toCollection().primaryKeys(),
  ]);
  const have = new Set(existing as string[]);
  const fresh = computeMilestones(p, records, results, advancements, transfers).filter((m) => !have.has(m.id));
  if (fresh.length) await db.milestones.bulkPut(fresh);
}
