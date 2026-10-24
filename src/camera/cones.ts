import { fitColour, matches, rgbToHsv, type ColourModel } from '../ball/colour';
import type { Pt } from '../db/types';

// Cone detection on the room photo (experimental, off by default; plan/09 V1 "when feasible").
// Colour blobs of cone colour, their base point taken as the cone's floor position, matched to
// the suggested positions. The parent checks and confirms every marker; nothing is used unconfirmed.

/** Typical orange training cones. The parent can teach another colour by tapping a cone. */
export const ORANGE: ColourModel = { h: 0.07, s: 0.75, v: 0.8, hSpread: 0.06, sSpread: 0.3, vSpread: 0.35 };

/** Colour model from a small patch round a tapped point. */
export function colourAt(rgba: Uint8ClampedArray, w: number, h: number, pt: Pt, r = 2): ColourModel {
  const cx = Math.round(pt.x * (w - 1));
  const cy = Math.round(pt.y * (h - 1));
  const px = [];
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      const k = 4 * (y * w + x);
      px.push(rgbToHsv(rgba[k], rgba[k + 1], rgba[k + 2]));
    }
  return fitColour(px);
}

export interface ConeBlob {
  base: Pt; // bottom centre of the blob (where the cone meets the floor), 0..1
  area: number; // fraction of the picture
}

export function findCones(rgba: Uint8ClampedArray, w: number, h: number, colour: ColourModel = ORANGE, within?: Pt[]): ConeBlob[] {
  const mask = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) mask[i] = matches(colour, rgbToHsv(rgba[j], rgba[j + 1], rgba[j + 2])) ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const out: ConeBlob[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let n = 0;
    let sx = 0;
    let maxY = 0;
    let minX = w;
    let maxX = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w;
      const y = (k / w) | 0;
      n++;
      sx += x;
      maxY = Math.max(maxY, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      for (const q of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k - w, k + w]) {
        if (q < 0 || q >= mask.length || seen[q] || !mask[q]) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const area = n / (w * h);
    // A cone is a small blob: not a speck, not a wall or a rug.
    if (area < 0.00015 || area > 0.02 || maxX - minX + 1 > w / 6) continue;
    const base = { x: (sx / n + 0.5) / w, y: (maxY + 0.5) / h };
    if (within && within.length >= 3 && !inside(base, within)) continue;
    out.push({ base, area });
  }
  return out;
}

function inside(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) c = !c;
  }
  return c;
}

/** Greedy nearest matching of suggested markers to detected cones; unmatched markers keep their place. */
export function assignCones(suggested: Pt[], found: Pt[], maxDist = 0.15): (Pt | null)[] {
  const pairs: { i: number; j: number; d: number }[] = [];
  suggested.forEach((s, i) => found.forEach((f, j) => pairs.push({ i, j, d: Math.hypot(s.x - f.x, s.y - f.y) })));
  pairs.sort((a, b) => a.d - b.d);
  const out: (Pt | null)[] = suggested.map(() => null);
  const used = new Set<number>();
  for (const p of pairs) {
    if (p.d > maxDist || out[p.i] || used.has(p.j)) continue;
    out[p.i] = found[p.j];
    used.add(p.j);
  }
  return out;
}
