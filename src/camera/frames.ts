// Small-frame image maths shared by the live tripwire, the framing check and
// the after-block analysis. Frames are grayscale Uint8Arrays of w×h.

export interface Gray {
  w: number;
  h: number;
  data: Uint8Array;
}

export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { w, h, data };
}

export function meanBrightness(g: Gray): number {
  let s = 0;
  for (let i = 0; i < g.data.length; i++) s += g.data[i];
  return s / g.data.length;
}

/** Share of masked pixels that changed by more than `threshold` between two frames. */
export function motionFraction(a: Gray, b: Gray, mask: Uint8Array | null, threshold = 25): number {
  let changed = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (mask && !mask[i]) continue;
    n++;
    if (Math.abs(a.data[i] - b.data[i]) > threshold) changed++;
  }
  return n ? changed / n : 0;
}

/** Normalised cross-correlation of b shifted by (dx, dy) against a, over the overlap. 1 = identical. */
export function ncc(a: Gray, b: Gray, dx = 0, dy = 0): number {
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  let n = 0;
  for (let y = Math.max(0, -dy); y < Math.min(a.h, a.h - dy); y++) {
    for (let x = Math.max(0, -dx); x < Math.min(a.w, a.w - dx); x++) {
      const va = a.data[y * a.w + x];
      const vb = b.data[(y + dy) * b.w + (x + dx)];
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
      n++;
    }
  }
  if (!n) return 0;
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2;
  const vb = sbb / n - (sb / n) ** 2;
  return va <= 0 || vb <= 0 ? 0 : cov / Math.sqrt(va * vb);
}

/** The shift of `now` relative to `ref` that matches best, searched within ±maxShift cells. */
export function bestShift(ref: Gray, now: Gray, maxShift = 8): { dx: number; dy: number; score: number } {
  let best = { dx: 0, dy: 0, score: -2 };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      const s = ncc(ref, now, dx, dy);
      if (s > best.score) best = { dx, dy, score: s };
    }
  }
  return best;
}

export type FramingResult = { ok: true; message: string } | { ok: false; message: string };

export const FRAMING = {
  minBrightness: 45,
  maxBrightness: 220,
  minSimilarity: 0.6, // NCC at zero shift that counts as "camera not moved"
  maxShiftCells: 2, // on a 64×36 grid ≈ 3% of the picture
};

/** Binary framing check (plan/13 §13.1): green, or red with a one-line fix. */
export function framingCheck(ref: Gray, now: Gray): FramingResult {
  const b = meanBrightness(now);
  if (b < FRAMING.minBrightness) return { ok: false, message: 'Too dark: turn on another light or add a lamp.' };
  if (b > FRAMING.maxBrightness) return { ok: false, message: 'Too bright: close a curtain or move the lamp out of the picture.' };
  const still = ncc(ref, now);
  const shift = bestShift(ref, now, 8);
  if (still >= FRAMING.minSimilarity && Math.abs(shift.dx) <= FRAMING.maxShiftCells && Math.abs(shift.dy) <= FRAMING.maxShiftCells) {
    return { ok: true, message: 'Camera set up as before.' };
  }
  if (shift.score >= FRAMING.minSimilarity) {
    // Picture content moved by (dx, dy): the camera turned the other way.
    const horiz = shift.dx > FRAMING.maxShiftCells ? 'turn the camera right' : shift.dx < -FRAMING.maxShiftCells ? 'turn the camera left' : '';
    const vert = shift.dy > FRAMING.maxShiftCells ? 'tilt it down' : shift.dy < -FRAMING.maxShiftCells ? 'tilt it up' : '';
    return { ok: false, message: `Camera has moved: ${[horiz, vert].filter(Boolean).join(' and ') || 'line it up with the reference photo'}.` };
  }
  return { ok: false, message: 'Camera picture does not match the set-up: check the camera and the cones, or ask a parent to redo the set-up.' };
}
