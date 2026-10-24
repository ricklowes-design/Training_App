import type { Pt } from '../db/types';
import type { TrackSample } from './track';

// Gate events and observable touches (part 17 BR-03, BR-04).

export interface GateEvent {
  gate: string;
  tMs: number;
  direction: 'forward' | 'backward';
  clearance: number; // fraction of the gate width from the nearer cone, 0..0.5
  confidence: number;
}

/** Which side of the line a→b a point is on (+/−). */
const side = (a: Pt, b: Pt, p: Pt) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));

export const GATE = { holdFrames: 2, refractoryMs: 700 };

/**
 * Crossings of the line between two cones. Hysteresis: the ball must be seen (not predicted) on one side
 * for `holdFrames` frames and then on the other for `holdFrames`, between the cones. Duplicate crossings
 * within the refractory time are suppressed; a crossing back counts as a backward event.
 */
export function gateEvents(track: TrackSample[], gate: { name: string; a: Pt; b: Pt }): GateEvent[] {
  const out: GateEvent[] = [];
  let stable = 0;
  let run = 0;
  let runSide = 0;
  let lastEventMs = -Infinity;
  for (const s of track) {
    if (s.predicted) continue;
    const sd = side(gate.a, gate.b, s);
    if (sd === 0) continue;
    if (sd === runSide) run++;
    else {
      runSide = sd;
      run = 1;
    }
    if (run < GATE.holdFrames) continue;
    if (stable === 0) {
      stable = sd;
      continue;
    }
    if (sd !== stable) {
      // Between the cones: project onto the gate line.
      const gx = gate.b.x - gate.a.x;
      const gy = gate.b.y - gate.a.y;
      const t = ((s.x - gate.a.x) * gx + (s.y - gate.a.y) * gy) / (gx * gx + gy * gy || 1);
      if (t >= 0 && t <= 1 && s.tMs - lastEventMs >= GATE.refractoryMs) {
        out.push({ gate: gate.name, tMs: s.tMs, direction: sd > 0 ? 'forward' : 'backward', clearance: Math.round(100 * Math.min(t, 1 - t)) / 100, confidence: s.confidence });
        lastEventMs = s.tMs;
      }
      stable = sd;
    }
  }
  return out;
}

export interface TouchEvent {
  tMs: number;
  status: 'confirmed' | 'possible';
  confidence: number;
}

export const TOUCH = { minTurnDeg: 35, minSpeedChange: 0.5, dedupMs: 150, minSpeed: 0.0002 };

/**
 * Touches from changes in the ball's path: a sharp turn or a speed jump between seen samples.
 * `confirmed` needs a supporting cue (a foot near the ball at that moment); without one it is `possible`.
 * Stretches with only predicted samples are unobservable and give no events at all.
 */
export function touches(track: TrackSample[], footNear?: (tMs: number) => boolean): TouchEvent[] {
  const seen = track.filter((s) => !s.predicted);
  const out: TouchEvent[] = [];
  for (let i = 1; i < seen.length - 1; i++) {
    const a = seen[i - 1];
    const b = seen[i];
    const c = seen[i + 1];
    const v1 = { x: (b.x - a.x) / (b.tMs - a.tMs || 1), y: (b.y - a.y) / (b.tMs - a.tMs || 1) };
    const v2 = { x: (c.x - b.x) / (c.tMs - b.tMs || 1), y: (c.y - b.y) / (c.tMs - b.tMs || 1) };
    const s1 = Math.hypot(v1.x, v1.y);
    const s2 = Math.hypot(v2.x, v2.y);
    if (Math.max(s1, s2) < TOUCH.minSpeed) continue;
    const turn = s1 > TOUCH.minSpeed && s2 > TOUCH.minSpeed ? (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (s1 * s2)))) * 180) / Math.PI : 0;
    const jump = Math.abs(s2 - s1) / Math.max(s1, s2);
    if (turn < TOUCH.minTurnDeg && jump < TOUCH.minSpeedChange) continue;
    if (out.length && b.tMs - out[out.length - 1].tMs < TOUCH.dedupMs) continue;
    const confirmed = !!footNear?.(b.tMs);
    out.push({ tMs: b.tMs, status: confirmed ? 'confirmed' : 'possible', confidence: Math.round(100 * Math.min(a.confidence, b.confidence, c.confidence)) / 100 });
  }
  return out;
}
