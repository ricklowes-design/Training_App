import type { Programme } from '../content/types';
import type { CameraSetup, RoomProfile, Settings } from '../db/types';
import { capstoneGates } from './capstone';

// The parent's readiness overview (Brief R06): three honest statements, each with what it actually
// needs and the one screen that fixes it. Recording ready is never described as scoring validated.

export type ReadyState = 'ready' | 'needsAction' | 'optional';
export type ReadySection = 'room' | 'camera' | 'validation';

export interface ReadinessItem {
  id: 'training' | 'recording' | 'measures';
  label: string;
  state: ReadyState;
  text: string;
  /** The screen that resolves it, when something is needed. */
  fix?: { section: ReadySection; label: string };
}

export function readiness(p: Programme, settings: Pick<Settings, 'camera' | 'validations'>, room: RoomProfile | undefined, setups: CameraSetup[]): ReadinessItem[] {
  const training: ReadinessItem = room
    ? { id: 'training', label: 'Training ready', state: 'ready', text: 'A safe floor area is set, so every drill without the camera can run.' }
    : { id: 'training', label: 'Training ready', state: 'needsAction', text: 'Set the room: a photo and the safe floor area (no measuring).', fix: { section: 'room', label: 'Set up the room' } };

  let recording: ReadinessItem;
  if (!settings.camera.enabled) {
    recording = { id: 'recording', label: 'Recording ready', state: 'optional', text: 'The camera is off. Training works without it; turn it on to record drills and get camera scorecards.', fix: { section: 'camera', label: 'Camera set-up' } };
  } else if (!setups.length) {
    recording = { id: 'recording', label: 'Recording ready', state: 'needsAction', text: 'The camera is on but no camera set-up is saved, so drills cannot be recorded yet.', fix: { section: 'camera', label: 'Save a camera set-up' } };
  } else {
    recording = { id: 'recording', label: 'Recording ready', state: 'ready', text: `Drills are recorded (${setups.length} camera set-up${setups.length === 1 ? '' : 's'}). Recording is not the same as validated scoring.` };
  }

  const { gates } = capstoneGates(p, settings);
  const passed = gates.filter((g) => g.passed).length;
  const measures: ReadinessItem =
    passed === gates.length && gates.length
      ? { id: 'measures', label: 'Measures validated', state: 'ready', text: 'Every camera measure has been checked against your own reading.' }
      : {
          id: 'measures',
          label: 'Measures validated',
          state: settings.camera.enabled ? 'needsAction' : 'optional',
          text: `${passed} of ${gates.length} camera measures checked against your reading. Until then, camera numbers are estimates and never move a stage on their own.`,
          fix: { section: 'validation', label: 'Check a measure' },
        };
  return [training, recording, measures];
}

export const READY_SYMBOL: Record<ReadyState, string> = { ready: '✓', needsAction: '!', optional: '–' };
export const READY_TEXT: Record<ReadyState, string> = { ready: 'ready', needsAction: 'needs action', optional: 'optional' };
