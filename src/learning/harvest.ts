import { logHistory } from '../app/data';
import type { Programme } from '../content/types';
import { db } from '../db/db';
import type { LearningExample } from '../db/types';
import { outcomeExamples } from './outcomes';
import { activate, freezeValidation, proposeCandidate, type ThresholdModel } from './service';

// Collects head-turn examples from analysed scanning blocks and, when personalisation is on, tries a new
// threshold by itself (owner decision 2026-10-30). Safe to run any number of times: example ids are fixed
// per rep, and a candidate is used only if it beats the current model on held-out sessions.

/** The base rule the scanning look starts from (analysis/compute.ts THRESHOLDS.lookShoulderWidths). */
export const SCAN_BASE: ThresholdModel = { feature: 'headTurn', threshold: 0.35, direction: 1 };
/** New examples needed since the last model before another candidate is tried. */
export const NEW_EXAMPLES_PER_TRY = 10;

/** Scanning drills whose cue is shown behind the player, with how many values the cue has. */
export function scanCueDrills(p: Programme): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of p.drills) {
    if (d.areaId !== 'scanning' || !d.cueDrillId) continue;
    const c = p.cueDrills.find((x) => x.id === d.cueDrillId);
    if (c?.values?.length) out.set(d.id, c.values.length);
  }
  return out;
}

export async function harvestOutcomeExamples(p: Programme, clipIds?: string[]): Promise<number> {
  const drills = scanCueDrills(p);
  const clips = clipIds ? (await db.clips.bulkGet(clipIds)).filter((c) => !!c) : await db.clips.filter((c) => !!c.drillId && drills.has(c.drillId)).toArray();
  const fresh: LearningExample[] = [];
  for (const clip of clips) {
    if (!clip.drillId || !drills.has(clip.drillId)) continue;
    const a = await db.blockAnalyses.get(clip.id);
    if (!a) continue;
    const reps = (await db.repAnalyses.where('clipId').equals(clip.id).toArray()).map((r) => r.data);
    const rec = await db.sessionRecords.get(clip.sessionRecordId);
    const block = rec?.blocks.find((b) => b.index === clip.blockIndex && b.attempt === clip.attempt);
    if (!rec || !block?.cueLog?.length) continue;
    const reviewIds = await db.learningExamples.where('id').startsWith(`${clip.id}:`).primaryKeys();
    const reviewed = new Set(reviewIds.filter((id) => id.endsWith(':look')).map((id) => Number(id.split(':')[1])));
    const exs = outcomeExamples({ clipId: clip.id, sessionRecordId: rec.id, date: clip.date, layoutVersion: rec.layoutVersion, cueValues: drills.get(clip.drillId)!, log: block.cueLog, reps, callOuts: block.callOuts, reviewed });
    // An example already in the frozen validation set stays there.
    const existing = new Map((await db.learningExamples.bulkGet(exs.map((e) => e.id))).filter((e) => !!e).map((e) => [e!.id, e!]));
    for (const e of exs) {
      const old = existing.get(e.id);
      // New, or a right call-out that arrived after the rep was first labelled from its move (a frozen
      // held-out example is never changed).
      if (!old || (old.labelSource === 'taskOutcome' && e.labelSource === 'callOut' && !old.inValidationSet)) fresh.push(e);
    }
  }
  if (fresh.length) await db.learningExamples.bulkPut(fresh);
  return fresh.length;
}

/** With personalisation on: freeze the held-out set once there are enough examples, then try a new
 *  scanning threshold whenever enough new examples have come in. Returns what happened, for History. */
export async function autoLearnScan(): Promise<string | null> {
  const s = await db.settings.get('main');
  const ls = await db.learningSettings.get('main');
  if (!s?.flags.learning || ls?.paused || ls?.components.scanPattern?.paused) return null;
  const examples = await db.learningExamples.where('component').equals('scanPattern').toArray();
  let set = await db.validationDatasets.get('scanPattern');
  if (!set) {
    const v = freezeValidation(examples, 'scanPattern', new Date().toISOString());
    if (!v) return null;
    await db.validationDatasets.put(v);
    await db.learningExamples.bulkPut(examples.filter((e) => v.exampleIds.includes(e.id)).map((e) => ({ ...e, inValidationSet: true })));
    set = v;
    await logHistory('app', 'learning', `Scanning look: validation set frozen (${v.exampleIds.length} examples)`);
  }
  const versions = await db.modelVersions.toArray();
  const last = versions.filter((v) => v.component === 'scanPattern').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const newSince = examples.filter((e) => !last || e.createdAt > last.createdAt).length;
  if (last && newSince < NEW_EXAMPLES_PER_TRY) return null;
  const r = proposeCandidate({ component: 'scanPattern', feature: 'headTurn', base: SCAN_BASE, examples, validation: set, versions, settings: ls, now: new Date().toISOString() });
  if (!r) return null;
  await db.modelVersions.bulkPut(activate(versions, r.candidate));
  // The first tested threshold sets the personalisation: speech call-outs are no longer needed, and
  // listening (which sends audio to Google) is switched off (owner request 2026-10-30).
  if (!s.scanCalibratedAt) {
    await db.settings.update('main', { scanCalibratedAt: new Date().toISOString(), flags: { ...s.flags, speechDiagnostic: false } });
    await logHistory('app', 'learning', 'Head-turn personalisation set: calling out numbers is no longer needed; hearing the numbers switched off');
  }
  const what = `Scanning look: candidate v${r.candidate.n} ${r.candidate.status === 'active' ? 'activated' : 'not used'} (${r.reason})`;
  await logHistory('app', 'learning', what);
  return what;
}
