import type { Programme } from '../content/types';
import { rng } from '../cue/engine';
import type { Settings } from '../db/types';
import type { RunBlock } from '../domain/plans';
import type { DefenderBlockConfig } from './block';
import type { ArchetypeId } from './engine';
import { MOCAP_RENDERER_VERSION_LABEL, RENDERER_VERSION_LABEL } from './version';
import { allowedModesAt, START_LEVEL } from './progression';

/** The defender set-up for a block, or null when the block uses word/arrow cues instead (part 15 D3):
 *  only work blocks of drills with a defender drill, with the 3D flag on and WebGL available. Anchors keep arrows. */
/** Whether a block will show the 3D defender (the same test defenderConfigFor makes), so instructions can match it. */
export function defenderWillShow(p: Programme, block: RunBlock, settings: Pick<Settings, 'flags' | 'capabilities'>): boolean {
  if (block.kind !== 'work' || !settings.flags?.defender3d) return false;
  const drill = p.drills.find((d) => d.id === block.drillId);
  if (!drill?.defenderDrillId || !p.defenderDrills.some((x) => x.id === drill.defenderDrillId)) return false;
  // No WebGL: the word/arrow cue engine is the fallback, recorded under its own cue level.
  return !(settings.capabilities && !settings.capabilities.webgl);
}

export function defenderConfigFor(p: Programme, block: RunBlock, settings: Settings, seed: number, modeLevel = START_LEVEL, tendency?: { leftShare: number; n: number }): DefenderBlockConfig | null {
  if (!defenderWillShow(p, block, settings)) return null;
  const drill = p.drills.find((d) => d.id === block.drillId);
  const dd = p.defenderDrills.find((x) => x.id === drill!.defenderDrillId)!;
  const r = rng(seed);
  const archetype = dd.archetypes[Math.floor(r() * dd.archetypes.length)] as ArchetypeId;
  return {
    drill: dd,
    reps: block.mode === 'reps' ? dd.reps : null,
    archetype,
    difficulty: dd.difficulty,
    allowedModes: dd.allowedModes ?? allowedModesAt(modeLevel, p.reactionModesProgression),
    modeLevel: dd.allowedModes ? undefined : modeLevel,
    // Personalisation is opt-in (Settings → Features) and can be paused at any time.
    tendency: settings.flags.learning ? tendency : undefined,
    // The live detector only when the parent turned it on and the camera runs; otherwise planned timing, labelled.
    trigger: settings.flags.liveOnsetDetector && settings.camera.enabled ? 'cameraOnset' : 'plannedTiming',
    view: 'player3d',
    motion: settings.flags.realisticDefender ? 'recorded' : 'procedural',
    seed,
    rendererVersion: settings.flags.realisticDefender ? MOCAP_RENDERER_VERSION_LABEL : RENDERER_VERSION_LABEL,
  };
}
