import type { DefenderReaction, Side } from '../db/types';

// Defender state machine (task 2.2). Pure: given a rep's scenario and the time since the
// rep started, returns the defender's body parameters. The renderer (3D or the 2D
// fallback) only draws them, so tests can check what the player will see.
//
// Coordinates are the player's view: x < 0 is the player's left (screen left), z is the
// distance from the player in metres.

export type DefenderState = 'approach' | 'stance' | 'reading' | 'commit' | 'hold' | 'recover' | 'done';

export interface DefenderMotion {
  approachMs: number;
  approachAngleDeg: number; // -25..25: where the approach comes from
  initialSide: Side | 'centre';
  reaction: DefenderReaction;
  commitDirection?: Side;
  strength: number; // 0..1
  reactionDelayMs: number;
  recovery: boolean;
}

export interface DefenderPose {
  state: DefenderState;
  x: number;
  z: number;
  yaw: number; // radians; 0 faces the player
  crouch: number; // 0 upright .. 1 low
  stanceWidth: number; // metres between the feet
  lean: number; // radians, + leans to the player's right
  hipShift: number; // metres, lateral shift of the hips relative to the feet centre
  stepPhase: number; // radians of the walking/shuffle cycle
  stepAmp: number; // 0..1 how much the legs swing
  armSpread: number; // 0..1
  weightSide: number; // -1 on the player's-left leg .. 1 on the right leg
  /** Recorded-motion renderer only: 19 joint positions (see mocap.ts), in the defender's own frame. */
  joints?: Float32Array;
}

export const START_Z = 7.5;
export const ENGAGE_Z = 3.0;
export const SETTLE_MS = 400;
const COMMIT_MS = 320;
export const RECOVER_HOLD_MS = 220;
const RECOVER_MS = 480;
export const DELAY_EXTRA_MS = 420;
const END_AFTER_MS = 1700;
const COMMIT_DIST = 0.75; // metres at strength 1

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
const sideSign = (s: Side | undefined) => (s === 'left' ? -1 : s === 'right' ? 1 : 0);

/** When the planned trigger falls: the defender has settled into its stance. */
export const plannedTriggerMs = (m: Pick<DefenderMotion, 'approachMs'>) => m.approachMs + SETTLE_MS;

/** The time the rep's reaction is over, relative to the rep start. */
export const repEndMs = (m: DefenderMotion, triggerMs: number) => triggerMs + m.reactionDelayMs + (m.reaction === 'delay' ? DELAY_EXTRA_MS : 0) + END_AFTER_MS;

/**
 * Pose at `t` ms after the rep started. `triggerMs` is when the feint was taken as begun
 * (planned timing, a parent tap, or the camera onset), or null while still waiting.
 */
export function poseAt(m: DefenderMotion, t: number, triggerMs: number | null): DefenderPose {
  const x0 = sideSign(m.initialSide === 'centre' ? undefined : m.initialSide) * 0.9 + Math.tan((m.approachAngleDeg * Math.PI) / 180) * 4;
  const base: DefenderPose = { state: 'approach', x: 0, z: ENGAGE_Z, yaw: 0, crouch: 0.55, stanceWidth: 0.55, lean: 0, hipShift: 0, stepPhase: 0, stepAmp: 0, armSpread: 0.5, weightSide: 0 };
  if (t < m.approachMs) {
    const u = ease(t / m.approachMs);
    const x = x0 * (1 - u);
    const z = START_Z + (ENGAGE_Z - START_Z) * u;
    return { ...base, state: 'approach', x, z, yaw: Math.atan2(-x0, START_Z - ENGAGE_Z) * (1 - u), crouch: 0.15 + 0.4 * u, stanceWidth: 0.3 + 0.25 * u, stepPhase: (t / 1000) * Math.PI * 4.2, stepAmp: 1 - 0.6 * u, armSpread: 0.2 + 0.3 * u };
  }
  const settle = clamp01((t - m.approachMs) / SETTLE_MS);
  const shuffle = Math.sin((t / 1000) * Math.PI * 3) * 0.04;
  if (triggerMs === null || t < triggerMs + m.reactionDelayMs) {
    return { ...base, state: triggerMs === null || t < triggerMs ? 'stance' : 'reading', x: shuffle * 0.5, crouch: 0.55 + 0.1 * settle, stepPhase: (t / 1000) * Math.PI * 3, stepAmp: 0.15, weightSide: shuffle * 5 };
  }
  let since = t - triggerMs - m.reactionDelayMs;
  if (m.reaction === 'hold') {
    // Square and patient: a small drop and a half-step back, no lateral move.
    const u = ease(since / 300);
    return { ...base, state: since > END_AFTER_MS ? 'done' : 'hold', z: ENGAGE_Z + 0.15 * u, crouch: 0.65 + 0.1 * u, stanceWidth: 0.6, armSpread: 0.65, stepAmp: 0.05 };
  }
  if (m.reaction === 'delay') {
    if (since < DELAY_EXTRA_MS) return { ...base, state: 'reading', crouch: 0.68, stepAmp: 0.1, x: shuffle * 0.5 };
    since -= DELAY_EXTRA_MS;
  }
  const dir = sideSign(m.commitDirection);
  const reach = COMMIT_DIST * (m.reaction === 'delay' ? 0.7 : 1) * (0.5 + 0.5 * m.strength);
  const c = ease(since / COMMIT_MS);
  const committed: DefenderPose = {
    ...base,
    state: 'commit',
    x: dir * reach * c,
    crouch: 0.7,
    stanceWidth: 0.55 + 0.35 * c,
    lean: dir * 0.35 * c,
    hipShift: dir * 0.18 * c,
    yaw: dir * 0.35 * c,
    stepAmp: 0,
    armSpread: 0.5 + 0.3 * c,
    weightSide: dir * c,
  };
  if (!m.recovery) return since > END_AFTER_MS ? { ...committed, state: 'done' } : committed;
  const back = since - COMMIT_MS - RECOVER_HOLD_MS;
  if (back <= 0) return committed;
  const r = ease(back / RECOVER_MS);
  return {
    ...committed,
    state: back > END_AFTER_MS ? 'done' : 'recover',
    x: committed.x * (1 - r),
    stanceWidth: committed.stanceWidth - 0.35 * r,
    lean: committed.lean * (1 - r) - dir * 0.12 * Math.sin(r * Math.PI),
    hipShift: committed.hipShift * (1 - r),
    yaw: committed.yaw * (1 - r),
    weightSide: committed.weightSide * (1 - 2 * r),
    stepPhase: r * Math.PI * 2,
    stepAmp: 0.4 * Math.sin(r * Math.PI),
  };
}
