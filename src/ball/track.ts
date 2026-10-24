import type { Detection } from './detect';

// Temporal tracking (part 17 BR-02): constant-velocity prediction, gating, and short
// occlusion bridging. A predicted position is flagged and is never a confirmed measurement.

export interface TrackSample {
  tMs: number;
  x: number;
  y: number;
  confidence: number;
  predicted: boolean;
}

export const TRACK = {
  gate: 0.12, // max jump (picture widths) per 33 ms frame, scaled by the time step
  maxPredictMs: 300, // bridge at most this long without a detection
  minConfidence: 0.35,
};

export class BallTracker {
  readonly track: TrackSample[] = [];
  private vx = 0;
  private vy = 0;
  private lastSeen: TrackSample | null = null;

  update(tMs: number, dets: Detection[]): TrackSample | null {
    const last = this.track[this.track.length - 1];
    const dt = last ? tMs - last.tMs : 33;
    const pred = last ? { x: last.x + this.vx * dt, y: last.y + this.vy * dt } : null;
    const gate = TRACK.gate * Math.max(1, dt / 33);
    // Nearest confident candidate to the prediction (similar objects further away are ignored).
    const cands = dets.filter((d) => d.confidence >= TRACK.minConfidence);
    const pick = pred
      ? cands.map((d) => ({ d, dist: Math.hypot(d.x - pred.x, d.y - pred.y) })).filter((c) => c.dist <= gate).sort((a, b) => a.dist - b.dist || b.d.confidence - a.d.confidence)[0]?.d
      : cands[0];
    if (pick) {
      if (this.lastSeen) {
        const ddt = Math.max(1, tMs - this.lastSeen.tMs);
        this.vx = 0.6 * ((pick.x - this.lastSeen.x) / ddt) + 0.4 * this.vx;
        this.vy = 0.6 * ((pick.y - this.lastSeen.y) / ddt) + 0.4 * this.vy;
      }
      const s: TrackSample = { tMs, x: pick.x, y: pick.y, confidence: pick.confidence, predicted: false };
      this.lastSeen = s;
      this.track.push(s);
      return s;
    }
    if (pred && this.lastSeen && tMs - this.lastSeen.tMs <= TRACK.maxPredictMs) {
      const age = (tMs - this.lastSeen.tMs) / TRACK.maxPredictMs;
      const s: TrackSample = { tMs, x: pred.x, y: pred.y, confidence: Math.round(100 * this.lastSeen.confidence * (1 - age) * 0.5) / 100, predicted: true };
      this.track.push(s);
      return s;
    }
    // Lost: start again from the next detection.
    this.vx = 0;
    this.vy = 0;
    if (last && !last.predicted) this.lastSeen = null;
    return null;
  }
}
