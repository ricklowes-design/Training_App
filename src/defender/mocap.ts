import type { Side } from '../db/types';
import { DELAY_EXTRA_MS, ENGAGE_Z, poseAt, RECOVER_HOLD_MS, SETTLE_MS, type DefenderMotion, type DefenderPose } from './stateMachine';

// Recorded-motion defender. The state machine still decides when and how the defender reacts
// (and so what is scored and logged); this module only chooses the body: joint positions taken
// from a recording of a real person defending (src/defender/mocap/clips.json, built by
// scripts/motion/clips.py). The approach run is not in the recording, so it uses the
// procedural body converted to the same joints, blended into the recorded guard as the
// defender settles.
//
// Joints are in metres in the defender's own frame: x to the player's right, y up from the
// floor, z toward the player; the hips are centred at x = z = 0. "left"/"right" joint names are
// the defender's own sides, so facing the player the defender's left side has the larger x.

export const JOINTS = ['nose', 'leftEar', 'rightEar', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftToe', 'rightToe'] as const;
export type JointName = (typeof JOINTS)[number];
export const J = Object.fromEntries(JOINTS.map((n, i) => [n, i])) as Record<JointName, number>;
const N = JOINTS.length * 3;
const PAIRS: [number, number][] = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18]];
const BLEND_MS = 150;

export interface ClipFile {
  format: string;
  fps: number;
  joints: string[];
  guard: { id: string; frames: number[][] };
  moves: { id: string; side: Side; turned: boolean; depthMm: number; commit: { frames: number[][]; rootXMm: number[] }; recover: { frames: number[][]; rootXMm: number[] } }[];
}
interface Clip {
  frames: Float32Array[];
  rootX: Float32Array;
}
export interface MocapMove {
  id: string;
  side: Side;
  mirrored: boolean;
  turned: boolean;
  depth: number;
  commit: Clip;
  recover: Clip;
}
export interface MocapLibrary {
  fps: number;
  guard: Float32Array[];
  moves: MocapMove[];
}

const toM = (f: number[]) => Float32Array.from(f, (v) => v / 1000);
/** The same frame seen in a mirror: x flips and the left and right joints swap. */
export function mirrorFrame(f: Float32Array): Float32Array {
  const o = new Float32Array(N);
  for (let j = 0; j < JOINTS.length; j++) {
    o[j * 3] = -f[j * 3];
    o[j * 3 + 1] = f[j * 3 + 1];
    o[j * 3 + 2] = f[j * 3 + 2];
  }
  for (const [a, b] of PAIRS)
    for (let k = 0; k < 3; k++) {
      const t = o[a * 3 + k];
      o[a * 3 + k] = o[b * 3 + k];
      o[b * 3 + k] = t;
    }
  return o;
}

/** Reads the clip file and adds the mirror image of every move, so both sides have the same variety. */
export function buildLibrary(file: ClipFile): MocapLibrary {
  if (file.format !== 'defender-clips/1' || file.joints.join() !== JOINTS.join()) throw new Error('unknown defender clip format');
  const clip = (c: { frames: number[][]; rootXMm: number[] }): Clip => ({ frames: c.frames.map(toM), rootX: Float32Array.from(c.rootXMm, (v) => v / 1000) });
  const moves: MocapMove[] = [];
  for (const m of file.moves) {
    const commit = clip(m.commit);
    const recover = clip(m.recover);
    moves.push({ id: m.id, side: m.side, mirrored: false, turned: m.turned, depth: m.depthMm / 1000, commit, recover });
    const mir = (c: Clip): Clip => ({ frames: c.frames.map(mirrorFrame), rootX: c.rootX.map((x) => -x) });
    moves.push({ id: `${m.id}-mirrored`, side: m.side === 'left' ? 'right' : 'left', mirrored: true, turned: m.turned, depth: m.depthMm / 1000, commit: mir(commit), recover: mir(recover) });
  }
  return { fps: file.fps, guard: file.guard.frames.map(toM), moves };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
function lerp(a: Float32Array, b: Float32Array, w: number): Float32Array {
  const o = new Float32Array(N);
  for (let i = 0; i < N; i++) o[i] = a[i] + (b[i] - a[i]) * w;
  return o;
}
function sample(frames: Float32Array[], fps: number, ms: number, loop = false): Float32Array {
  const len = frames.length;
  let f = (ms * fps) / 1000;
  if (loop) f = ((f % len) + len) % len;
  else f = Math.max(0, Math.min(len - 1, f));
  const i = Math.floor(f);
  const j = loop ? (i + 1) % len : Math.min(len - 1, i + 1);
  return lerp(frames[i], frames[j], f - i);
}
function sampleX(xs: Float32Array, fps: number, ms: number): number {
  const f = Math.max(0, Math.min(xs.length - 1, (ms * fps) / 1000));
  const i = Math.floor(f);
  const j = Math.min(xs.length - 1, i + 1);
  return xs[i] + (xs[j] - xs[i]) * (f - i);
}
const clipMs = (c: Clip, fps: number) => ((c.frames.length - 1) * 1000) / fps;

/** The recorded move for a rep: same rep, same move (replays match), toward the commit side;
 *  turned (hips-open) moves only for strong commits that stay committed, shallower ones for a late reaction. */
export function pickMove(lib: MocapLibrary, m: DefenderMotion): MocapMove {
  const side = m.commitDirection ?? 'left';
  let pool = lib.moves.filter((x) => x.side === side && (m.strength >= 0.8 && !m.recovery ? true : !x.turned));
  if (m.reaction === 'delay') {
    const depths = pool.map((x) => x.depth).sort((a, b) => a - b);
    const median = depths[Math.floor(depths.length / 2)];
    pool = pool.filter((x) => x.depth <= median);
  }
  if (!pool.length) pool = lib.moves.filter((x) => x.side === side);
  const key = Math.abs(Math.round(m.strength * 997 + m.approachAngleDeg * 31 + m.reactionDelayMs * 7 + m.approachMs));
  return pool[key % pool.length];
}

/** The procedural body (the one scene.ts draws) as the same 19 joints, used for the approach run. */
export function proceduralJoints(p: DefenderPose): Float32Array {
  const o = new Float32Array(N);
  const set = (j: number, x: number, y: number, z: number) => ((o[j * 3] = x), (o[j * 3 + 1] = y), (o[j * 3 + 2] = z));
  const hipY = 0.92 - 0.32 * p.crouch;
  const half = p.stanceWidth / 2;
  const step = (s: number) => 0.18 * p.stepAmp * Math.sin(p.stepPhase + s);
  const lift = (s: number) => 0.08 * p.stepAmp * Math.max(0, Math.sin(p.stepPhase + s));
  const shift = p.hipShift + p.weightSide * 0.06;
  // Feet: the defender's left foot is on the player's right (+x).
  const feet: [number, number, number, number, number][] = [
    [J.leftAnkle, J.leftHeel, J.leftToe, half, 0],
    [J.rightAnkle, J.rightHeel, J.rightToe, -half, Math.PI],
  ];
  const footPos: number[][] = [];
  for (const [a, h, t, x, ph] of feet) {
    const y = lift(ph);
    const z = step(ph);
    set(a, x, 0.08 + y, z - 0.03);
    set(h, x, 0.02 + y, z - 0.09);
    set(t, x, 0.02 + y, z + 0.14);
    footPos.push([x, 0.08 + y, z - 0.03]);
  }
  const hips: [number, number][] = [
    [J.leftHip, shift + 0.1],
    [J.rightHip, shift - 0.1],
  ];
  for (let k = 0; k < 2; k++) {
    const [jh, hx] = hips[k];
    const hip = [hx, hipY - 0.05, 0];
    set(jh, hip[0], hip[1], hip[2]);
    // Knee: two-bone IK bending forward (toward the player).
    const [fx, fy, fz] = footPos[k];
    const dx = fx - hip[0], dy = fy - hip[1], dz = fz - hip[2];
    const len = Math.min(Math.hypot(dx, dy, dz), 0.92 - 1e-3);
    const along = len / 2;
    const out = Math.sqrt(Math.max(0, 0.46 * 0.46 - along * along));
    const u = [dx / (Math.hypot(dx, dy, dz) || 1), dy / (Math.hypot(dx, dy, dz) || 1), dz / (Math.hypot(dx, dy, dz) || 1)];
    // Forward direction perpendicular to the leg.
    const fw = [0 - u[2] * u[0], 0 - u[2] * u[1], 1 - u[2] * u[2]];
    const fl = Math.hypot(fw[0], fw[1], fw[2]) || 1;
    set(k === 0 ? J.leftKnee : J.rightKnee, hip[0] + u[0] * along + (fw[0] / fl) * out, hip[1] + u[1] * along + (fw[1] / fl) * out, hip[2] + u[2] * along + (fw[2] / fl) * out);
  }
  // Torso: pitched forward with the crouch, leaning sideways; rotation order as in scene.ts (X then Z).
  const ax = 0.45 * p.crouch;
  const az = -p.lean;
  const rot = (x: number, y: number, z: number): [number, number, number] => {
    const x1 = x * Math.cos(az) - y * Math.sin(az);
    const y1 = x * Math.sin(az) + y * Math.cos(az);
    return [x1, y1 * Math.cos(ax) - z * Math.sin(ax), y1 * Math.sin(ax) + z * Math.cos(ax)];
  };
  const base = [shift, hipY + 0.05, 0];
  const at = (x: number, y: number, z: number) => {
    const r = rot(x, y, z);
    return [base[0] + r[0], base[1] + r[1], base[2] + r[2]];
  };
  const head = at(0, 0.68, 0);
  set(J.nose, head[0], head[1] - 0.01, head[2] + 0.1);
  set(J.leftEar, head[0] + 0.08, head[1], head[2] - 0.01);
  set(J.rightEar, head[0] - 0.08, head[1], head[2] - 0.01);
  const spread = 0.25 + 0.55 * p.armSpread;
  for (const [s, sh, el, wr] of [
    [1, J.leftShoulder, J.leftElbow, J.leftWrist],
    [-1, J.rightShoulder, J.rightElbow, J.rightWrist],
  ] as const) {
    const S = at(s * 0.22, 0.5, 0);
    const E = [S[0] + s * Math.sin(spread) * 0.3, S[1] - Math.cos(spread) * 0.3, S[2] + 0.05];
    set(sh, S[0], S[1], S[2]);
    set(el, E[0], E[1], E[2]);
    set(wr, E[0] + s * 0.08, E[1] - 0.25, E[2] + 0.12);
  }
  return o;
}

/**
 * The recorded-motion pose at `t` ms into the rep. `pose` is the state machine's pose at the
 * same moment (its state is kept, so logging and tests see the same reaction); the body and the
 * lateral position come from the recorded move.
 */
export function mocapPose(lib: MocapLibrary, m: DefenderMotion, t: number, triggerMs: number | null, pose: DefenderPose): DefenderPose {
  if (t < m.approachMs) return { ...pose, joints: proceduralJoints(pose) };
  const fps = lib.fps;
  const since0 = t - m.approachMs;
  let guard = sample(lib.guard, fps, since0, true);
  if (since0 < SETTLE_MS) {
    // Settle from the end of the run into the recorded guard.
    const endOfRun = proceduralJoints(poseAt(m, m.approachMs - 1, null));
    guard = lerp(endOfRun, guard, ease(since0 / SETTLE_MS));
  }
  const still: DefenderPose = { ...pose, x: 0, z: ENGAGE_Z, yaw: 0, joints: guard };
  if (triggerMs === null) return still;
  const start = triggerMs + m.reactionDelayMs + (m.reaction === 'delay' ? DELAY_EXTRA_MS : 0);
  if (t < start) return still;
  // Hold: stays square in its guard; the state machine's half-step back is kept.
  if (m.reaction === 'hold') return { ...still, z: pose.z };
  const move = pickMove(lib, m);
  const since = t - start;
  const cMs = clipMs(move.commit, fps);
  if (since < cMs) {
    const body = sample(move.commit.frames, fps, since);
    return { ...still, x: sampleX(move.commit.rootX, fps, since), joints: lerp(guard, body, ease(since / BLEND_MS)) };
  }
  const committed: DefenderPose = { ...still, x: move.commit.rootX[move.commit.rootX.length - 1], joints: move.commit.frames[move.commit.frames.length - 1] };
  if (!m.recovery) return committed;
  const back = since - cMs - RECOVER_HOLD_MS;
  if (back <= 0) return committed;
  const rMs = clipMs(move.recover, fps);
  if (back < rMs) return { ...still, x: sampleX(move.recover.rootX, fps, back), joints: sample(move.recover.frames, fps, back) };
  const last = move.recover.frames[move.recover.frames.length - 1];
  return { ...still, x: 0, joints: lerp(last, guard, ease((back - rMs) / BLEND_MS)) };
}
