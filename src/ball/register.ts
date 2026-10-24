import { fitColour, matches, rgbToHsv, type ColourModel, type Hsv } from './colour';

// Ball registration (part 17 BR-01): from a tap on the ball in a still frame, grow the region of
// similar colour, keep its pixels and its apparent size, and judge whether enough varied samples
// separate the ball from the room.

export interface Capture {
  kind: 'stationary' | 'rotating' | 'toward' | 'away';
  pixels: Hsv[];
  diameterPx: number;
  y: number; // 0..1 centre height
}

/** Region growing from a tapped pixel on an RGBA image. Returns the ball's pixels and size, or null. */
export function captureAt(rgba: Uint8ClampedArray, w: number, h: number, tx: number, ty: number, kind: Capture['kind']): Capture | null {
  const idx = (x: number, y: number) => 4 * (y * w + x);
  const seed = rgbToHsv(rgba[idx(tx, ty)], rgba[idx(tx, ty) + 1], rgba[idx(tx, ty) + 2]);
  const model: ColourModel = { ...seed, hSpread: 0.06, sSpread: 0.25, vSpread: 0.3 };
  const seen = new Uint8Array(w * h);
  const stack = [ty * w + tx];
  seen[ty * w + tx] = 1;
  const pixels: Hsv[] = [];
  let minX = tx;
  let maxX = tx;
  let minY = ty;
  let maxY = ty;
  while (stack.length && pixels.length < 40_000) {
    const k = stack.pop()!;
    const x = k % w;
    const y = (k / w) | 0;
    const p = rgbToHsv(rgba[4 * k], rgba[4 * k + 1], rgba[4 * k + 2]);
    if (!matches(model, p)) continue;
    pixels.push(p);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (seen[q]) continue;
      seen[q] = 1;
      stack.push(q);
    }
  }
  if (pixels.length < 12) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  // A region spreading far beyond a disc is the floor or a wall, not the ball.
  if (pixels.length / (bw * bh) < 0.45 || Math.max(bw, bh) > w / 3) return null;
  return { kind, pixels, diameterPx: Math.max(bw, bh), y: (minY + maxY) / 2 / h };
}

export interface Sufficiency {
  ok: boolean;
  reasons: string[];
  colour: ColourModel;
  backgroundMatchShare: number;
}

export function sufficiency(captures: Capture[], background: Hsv[]): Sufficiency {
  const colour = fitColour(captures.flatMap((c) => c.pixels.filter((_, i) => i % 3 === 0)));
  const bgMatch = background.length ? background.filter((p) => matches(colour, p)).length / background.length : 1;
  const kinds = new Set(captures.map((c) => c.kind));
  const reasons: string[] = [];
  if (captures.length < 6) reasons.push(`${6 - captures.length} more capture(s) needed`);
  if (kinds.size < 3) reasons.push('capture the ball still, rolling and moving toward or away from the camera');
  if (bgMatch > 0.03) reasons.push(`the room has too much of the ball's colour (${Math.round(bgMatch * 100)}% of the background matches); a brighter, single-colour ball helps`);
  return { ok: reasons.length === 0, reasons, colour, backgroundMatchShare: Math.round(1000 * bgMatch) / 1000 };
}
