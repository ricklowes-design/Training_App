import { describe, expect, it } from 'vitest';
import type { Settings } from '../db/types';
import { loadProgramme } from '../test/fixtures';
import { blockUses, listText, missingFor, turnOnPatch } from './needs';
import type { RunBlock } from './plans';

const p = loadProgramme();
const work = (drillId: string): RunBlock => ({ kind: 'work', minutes: 4, mode: 'reps', drillId });
const off = {
  camera: { enabled: false, retentionDays: 30, pose: 'lite', analysisFps: 15 },
  cueEngine: false,
  flags: { defender3d: false, liveOnsetDetector: false, speechDiagnostic: false, notifications: false, ballTracking: false, learning: false, coneDetection: false, neuralBallDetector: false },
  sound: { tones: true, speech: true, endOfSessionLine: true, volume: 1, voiceRate: 1, wallMic: false },
} as unknown as Settings;

describe('what a drill needs switched on', () => {
  it('a defender drill uses the camera, cues, the 3D defender and the feint detector', () => {
    expect(blockUses(p, work('F5'), false)).toEqual(['speech', 'tones', 'camera', 'cueEngine', 'defender3d', 'liveOnsetDetector']);
  });

  it('a wall drill in a wall room also listens for the wall; not in a room without one', () => {
    expect(blockUses(p, work('S2'), true)).toContain('wallMic');
    expect(blockUses(p, work('S2'), false)).not.toContain('wallMic');
  });

  it('only what is off is offered, once, and the patch turns exactly those on', () => {
    const miss = missingFor(p, [work('F5'), work('D1'), work('F6')], off, false);
    expect(miss).toEqual(['camera', 'cueEngine', 'defender3d', 'liveOnsetDetector', 'ballTracking']);
    const patch = turnOnPatch(miss, off);
    expect(patch.camera?.enabled).toBe(true);
    expect(patch.cueEngine).toBe(true);
    expect(patch.flags).toMatchObject({ defender3d: true, liveOnsetDetector: true, ballTracking: true, learning: false, notifications: false });
    expect(patch.sound).toBeUndefined();
    expect(missingFor(p, [work('F5')], { ...off, ...patch } as Settings, false)).toEqual([]);
  });

  it('a warm-up or rest needs nothing beyond sound', () => {
    expect(missingFor(p, [{ kind: 'rest', minutes: 1, mode: 'timed' }], off, true)).toEqual([]);
  });

  it('lists in plain words', () => {
    expect(listText(['camera', 'defender3d', 'speech'])).toBe('camera recording, the 3D defender and the voice');
  });
});
