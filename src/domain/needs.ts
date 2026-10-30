import type { Programme } from '../content/types';
import { cueDrillFor, usesWall } from '../cue/resolve';
import type { FeatureFlags, Settings } from '../db/types';
import type { RunBlock } from './plans';

// "Turn on what this drill needs" (parent request 2026-10-29): the switches a block uses that are
// off right now, and the settings patch that turns them on. Experimental and optional extras
// (rapid touches, realistic motion, personalisation, detectors) are not "needed" and stay as they are.

export type NeedKey = 'camera' | 'cueEngine' | 'defender3d' | 'liveOnsetDetector' | 'ballTracking' | 'wallMic' | 'speech' | 'tones' | 'speechDiagnostic';

export const NEED_LABELS: Record<NeedKey, string> = {
  camera: 'camera recording',
  cueEngine: 'cues on the screen',
  defender3d: 'the 3D defender',
  liveOnsetDetector: 'the feint detector',
  ballTracking: 'ball tracking',
  wallMic: 'listening for the wall',
  speech: 'the voice',
  tones: 'the tones',
  speechDiagnostic: 'hearing the numbers called out',
};

type NeedSettings = Pick<Settings, 'camera' | 'cueEngine' | 'flags' | 'sound'> & Partial<Pick<Settings, 'scanCalibratedAt'>>;

const recordable = (b: RunBlock) => b.kind === 'work' || b.kind === 'benchmark' || b.kind === 'anchor';

/** What a block would use if it were on. */
export function blockUses(p: Programme, b: RunBlock, wallUsable: boolean | undefined): NeedKey[] {
  if (!recordable(b)) return b.kind === 'warmup' ? ['speech', 'tones'] : [];
  const drill = p.drills.find((d) => d.id === (b.drillId ?? p.anchors.find((a) => a.id === b.anchorId)?.drillId));
  const out: NeedKey[] = ['speech', 'tones', 'camera'];
  if (cueDrillFor(p, b)) out.push('cueEngine');
  if (b.kind === 'work' && drill?.defenderDrillId) out.push('defender3d', 'liveOnsetDetector');
  if (drill && (drill.areaId === 'dribbling' || drill.areaId === 'control')) out.push('ballTracking');
  if (usesWall(p, b, wallUsable)) out.push('wallMic');
  // The number call-out drill (diagnostic / head-turn calibration) listens for the numbers.
  if (b.kind === 'work' && b.params?.startsWith('diagnostic')) out.push('speechDiagnostic');
  return out;
}

export function isOn(k: NeedKey, s: NeedSettings): boolean {
  switch (k) {
    case 'camera':
      return s.camera.enabled;
    case 'cueEngine':
      return s.cueEngine;
    case 'wallMic':
      return s.sound.wallMic !== false;
    case 'speech':
      return s.sound.speech;
    case 'tones':
      return s.sound.tones;
    default:
      return !!s.flags[k as keyof FeatureFlags];
  }
}

/** The switches the blocks use that are off now (each once, in a stable order). */
export function missingFor(p: Programme, blocks: RunBlock[], s: NeedSettings, wallUsable: boolean | undefined): NeedKey[] {
  const used = new Set(blocks.flatMap((b) => blockUses(p, b, wallUsable)));
  // Hearing the numbers is needed only until the head-turn personalisation is set (owner request 2026-10-30).
  return (Object.keys(NEED_LABELS) as NeedKey[]).filter((k) => used.has(k) && !isOn(k, s) && !(k === 'speechDiagnostic' && s.scanCalibratedAt));
}

/** The settings patch that turns these on. */
export function turnOnPatch(keys: NeedKey[], s: NeedSettings): Partial<NeedSettings> {
  const patch: Partial<NeedSettings> = {};
  const flags = { ...s.flags };
  const sound = { ...s.sound };
  for (const k of keys) {
    if (k === 'camera') patch.camera = { ...s.camera, enabled: true };
    else if (k === 'cueEngine') patch.cueEngine = true;
    else if (k === 'wallMic') sound.wallMic = true;
    else if (k === 'speech') sound.speech = true;
    else if (k === 'tones') sound.tones = true;
    else flags[k] = true;
  }
  if (keys.some((k) => k === 'defender3d' || k === 'liveOnsetDetector' || k === 'ballTracking' || k === 'speechDiagnostic')) patch.flags = flags;
  if (keys.some((k) => k === 'wallMic' || k === 'speech' || k === 'tones')) patch.sound = sound;
  return patch;
}

/** "camera recording, the 3D defender and the voice" */
export function listText(keys: NeedKey[]): string {
  const l = keys.map((k) => NEED_LABELS[k]);
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
}
