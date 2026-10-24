// Low-latency feint onset and direction (task 3.3, part 15 D5). Bounded pixel motion in the
// left and right halves of the lane on the 64×36 picture, no pose: cheap enough to run live.
// Only triggers the defender animation; it is never a scored measurement. When it is not
// confident, nothing is reported and the block falls back to planned timing (labelled).

export interface Onset {
  onsetMs: number; // first frame above the motion level
  reportMs: number; // when the direction estimate was ready (the trigger time)
  /** Direction of the initial movement in picture terms; the caller turns it into her side. */
  pictureSide?: 'left' | 'right';
  confidence: number; // 0..1
  /** Size of the movement relative to the resting level, 0..1: an estimate, never a technique score. */
  quality: number;
}

export const ONSET = {
  baselineMs: 600,
  sd: 4,
  minRise: 0.02,
  framesAbove: 2,
  directionMs: 180,
  refractoryMs: 900,
  minConfidence: 0.5,
};

export class OnsetDetector {
  private hist: { t: number; l: number; r: number }[] = [];
  private pending: { onsetMs: number; above: number } | null = null;
  private lastOnsetMs = -Infinity;
  readonly onsets: Onset[] = [];

  feed(tMs: number, left: number, right: number): Onset | null {
    this.hist.push({ t: tMs, l: left, r: right });
    while (this.hist.length && this.hist[0].t < tMs - ONSET.baselineMs - ONSET.directionMs - 400) this.hist.shift();
    if (tMs - this.lastOnsetMs < ONSET.refractoryMs) return null;
    if (!this.pending) {
      const base = this.hist.filter((h) => h.t < tMs - 60 && h.t >= tMs - ONSET.baselineMs - 60).map((h) => h.l + h.r);
      if (base.length < 5) return null;
      const mean = base.reduce((a, b) => a + b, 0) / base.length;
      const sd = Math.sqrt(base.reduce((a, b) => a + (b - mean) ** 2, 0) / base.length);
      const level = Math.max(mean + ONSET.sd * sd, mean + ONSET.minRise);
      if (left + right > level) this.pending = { onsetMs: tMs, above: 1 };
      return null;
    }
    const p = this.pending;
    if (tMs - p.onsetMs < ONSET.directionMs) {
      if (left + right > 0) p.above++;
      return null;
    }
    this.pending = null;
    const win = this.hist.filter((h) => h.t >= p.onsetMs && h.t <= tMs);
    if (p.above < ONSET.framesAbove || win.length < 2) return null;
    const L = win.reduce((a, h) => a + h.l, 0);
    const R = win.reduce((a, h) => a + h.r, 0);
    const asym = (L - R) / Math.max(1e-6, L + R);
    const base = this.hist.filter((h) => h.t < p.onsetMs).map((h) => h.l + h.r);
    const rest = base.length ? base.reduce((a, b) => a + b, 0) / base.length : 0;
    const peak = Math.max(...win.map((h) => h.l + h.r));
    const snr = Math.min(1, (peak - rest) / (rest + 0.05));
    const confidence = Math.round(100 * Math.min(1, Math.abs(asym) * 1.5) * snr) / 100;
    const o: Onset = { onsetMs: p.onsetMs, reportMs: tMs, pictureSide: Math.abs(asym) >= 0.15 ? (asym > 0 ? 'left' : 'right') : undefined, confidence, quality: Math.round(100 * snr) / 100 };
    this.lastOnsetMs = p.onsetMs;
    if (confidence < ONSET.minConfidence) return null; // not confident: no trigger, planned timing takes over
    this.onsets.push(o);
    if (this.onsets.length > 20) this.onsets.shift();
    return o;
  }
}
