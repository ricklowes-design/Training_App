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
/** "Try it" rounds: this many reps, each cue shown at least this long, reps this much further apart. */
export const PRACTICE = { reps: 3, minDisplayS: 5, periodFactor: 1.6 };

/** Whether a block runs its wall version: the room's wall can be used and the drill (or the drill that teaches a test's cue) has one. */
export function usesWall(p: Programme, block: RunBlock, wallUsable: boolean | undefined): boolean {
  if (!wallUsable) return false;
  const c = cueDrillFor(p, block);
  const own = p.drills.find((d) => d.id === block.drillId);
  const anchorDrill = block.anchorId ? p.drills.find((d) => d.id === p.anchors.find((a) => a.id === block.anchorId)?.drillId) : undefined;
  const teaching = own ?? anchorDrill ?? (c ? p.drills.find((d) => d.cueDrillId === c.id) : undefined);
  return !!teaching?.stepsWall?.length;
}

export function cueConfigFor(p: Programme, block: RunBlock, opts: { useTripwire: boolean; seed?: number; practice?: boolean; sound?: boolean }): CueConfig | null {
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
  const found = cueId ? p.cueDrills.find((c) => c.id === cueId) : undefined;
  if (!found || !found.values?.length) return null;
  if (block.kind === 'benchmark') reps = found.reps ?? 10;
  // Wall version: one cue per kick, on the bang (an interval drill such as the colours becomes one colour per kick).
  const walled = opts.sound ? { ...found, trigger: 'rep' as const, repPeriodS: found.trigger === 'interval' ? 6 : found.repPeriodS } : found;
  // A practice round is slow: a few reps, the word up longer, more time between reps, no tricks.
  const drill = opts.practice ? { ...walled, repPeriodS: Math.round((walled.repPeriodS ?? 8) * PRACTICE.periodFactor) } : walled;
  if (opts.practice) {
    reps = PRACTICE.reps;
    const d = displayOverride ?? parseDisplayS(block.params, block.cueLevel, found.displayS);
    displayOverride = [Math.max(PRACTICE.minDisplayS, d[0]), Math.max(PRACTICE.minDisplayS, d[1])];
    catchOverride = 0;
  }
  return {
    drill,
    displayS: displayOverride ?? parseDisplayS(block.params, block.cueLevel, drill.displayS),
    reps,
    useTripwire: (opts.sound || opts.useTripwire) && (drill.trigger ?? 'rep') === 'rep',
    soundTrigger: !!opts.sound,
    fixedTripwireDelayMs,
    catchFraction: catchOverride ?? drill.catchFraction ?? 0,
    catchTypes: drill.catchTypes ?? [],
    // Advanced scanning: the open side can change once after the first cue (part 16 §5 mode C).
    secondCueFraction: opts.practice ? 0 : /second information change/i.test(block.params ?? '') && drill.secondCue ? Math.max(0.3, drill.secondCue.fraction) : drill.secondCue?.fraction ?? 0,
    seed: opts.seed,
    hidden: !opts.practice && /no information/i.test(block.params ?? ''),
  };
}

/** Condition label stored with results from a block that used the engine. */
export const engineCueLevel = (cfg: CueConfig) => (cfg.useTripwire ? 'engine-tripwire' : 'engine-timed');
