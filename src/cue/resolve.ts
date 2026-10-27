import type { Programme } from '../content/types';
import type { RunBlock } from '../domain/plans';
import { parseDisplayS, type CueConfig } from './engine';

/** The cue drill a block uses (its words or arrows), if any. */
export function cueDrillFor(p: Programme, block: RunBlock): Programme['cueDrills'][number] | undefined {
  let cueId: string | undefined;
  if (block.kind === 'anchor') {
    const an = p.anchors.find((a) => a.id === block.anchorId);
    if (!an || an.id === 'A1' || an.id === 'A2') return undefined;
    cueId = p.drills.find((d) => d.id === an.drillId)?.cueDrillId;
  } else if (block.kind === 'benchmark') cueId = block.benchmarkId ? p.benchmarkCueDrills?.[block.benchmarkId] : undefined;
  else if (block.kind === 'work') cueId = p.drills.find((d) => d.id === block.drillId)?.cueDrillId;
  const drill = cueId ? p.cueDrills.find((c) => c.id === cueId) : undefined;
  return drill?.values?.length ? drill : undefined;
}

/** The cue drill and settings for a block, or null when the block has no cues. */
export function cueConfigFor(p: Programme, block: RunBlock, opts: { useTripwire: boolean; seed?: number }): CueConfig | null {
  let cueId: string | undefined;
  let reps: number | null = null;
  let fixedTripwireDelayMs: number | undefined;
  let displayOverride: [number, number] | undefined;
  let catchOverride: number | undefined;

  if (block.kind === 'anchor') {
    const an = p.anchors.find((a) => a.id === block.anchorId);
    if (!an) return null;
    cueId = p.drills.find((d) => d.id === an.drillId)?.cueDrillId;
    const c = an.conditions as { reps?: number; cueDelayMs?: number; catchTrials?: number; cueS?: number };
    reps = c.reps ?? null;
    fixedTripwireDelayMs = c.cueDelayMs;
    if (c.cueS) displayOverride = [c.cueS, c.cueS];
    if (c.catchTrials !== undefined) catchOverride = c.catchTrials;
    // A1 and A2 are not cue drills.
    if (an.id === 'A1' || an.id === 'A2') return null;
  } else if (block.kind === 'benchmark') {
    cueId = block.benchmarkId ? p.benchmarkCueDrills?.[block.benchmarkId] : undefined;
  } else if (block.kind === 'work') {
    cueId = p.drills.find((d) => d.id === block.drillId)?.cueDrillId;
  }
  const drill = cueId ? p.cueDrills.find((c) => c.id === cueId) : undefined;
  if (!drill || !drill.values?.length) return null;
  if (block.kind === 'benchmark') reps = drill.reps ?? 10;
  return {
    drill,
    displayS: displayOverride ?? parseDisplayS(block.params, block.cueLevel, drill.displayS),
    reps,
    useTripwire: opts.useTripwire && (drill.trigger ?? 'rep') === 'rep',
    fixedTripwireDelayMs,
    catchFraction: catchOverride ?? drill.catchFraction ?? 0,
    catchTypes: drill.catchTypes ?? [],
    // Advanced scanning: the open side can change once after the first cue (part 16 §5 mode C).
    secondCueFraction: /second information change/i.test(block.params ?? '') && drill.secondCue ? Math.max(0.3, drill.secondCue.fraction) : drill.secondCue?.fraction ?? 0,
    seed: opts.seed,
    hidden: /no information/i.test(block.params ?? ''),
  };
}

/** Condition label stored with results from a block that used the engine. */
export const engineCueLevel = (cfg: CueConfig) => (cfg.useTripwire ? 'engine-tripwire' : 'engine-timed');
