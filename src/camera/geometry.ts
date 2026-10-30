import type { Pt } from '../db/types';

// Picture ↔ floor mapping from the parent's four cone taps (task 15), and
// polygon masks for zones. Picture points are 0..1 of width and height.

/** Solves A x = b by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** 3×3 homography (row-major, h33 = 1) mapping src points to dst points. Needs 4 points, no three collinear. */
export function homography(src: [number, number][], dst: [number, number][]): number[] | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

export function applyH(h: number[], [x, y]: [number, number]): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Boolean mask (row-major, w×h) of the cells whose centres fall inside the polygon. */
export function polygonMask(poly: Pt[], w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h);
  if (poly.length < 3) return m;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pointInPolygon({ x: (x + 0.5) / w, y: (y + 0.5) / h }, poly)) m[y * w + x] = 1;
  return m;
}

/** Splits a polygon's mask into its left and right halves (by the polygon's centre x), for the shaping side. */
export function splitMask(mask: Uint8Array, w: number, h: number): [Uint8Array, Uint8Array] {
  let sx = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    sx += i % w;
    n++;
  }
  const cx = n ? sx / n : w / 2;
  const left = new Uint8Array(w * h);
  const right = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) if (mask[i]) (i % w < cx ? left : right)[i] = 1;
  return [left, right];
}

/** Floor positions (metres) of the four calibration cones for each drill family, from the room layout.
 *  x: across the room (0 = lane centre, + = right as the player faces the camera); y: along the lane from the start wall. */
export function calibrationCones(
  family: 'L1' | 'L2' | 'L3' | 'L4',
  d: { slalomFirstConeM: number; slalomSpacingM: number; feintConeM: number; feintGateAtM: number; feintGateWidthM: number; receiveBoxSideM: number; masterySquareM: number; feintStartM?: number },
  laneHalfWidthM = 0.5,
  gateOffsetM = 0.8,
): { name: string; floor: [number, number] }[] {
  switch (family) {
    case 'L2':
      return [
        { name: 'start cone', floor: [0, d.feintStartM ?? 0.5] },
        { name: 'feint cone', floor: [0, d.feintConeM] },
        { name: 'left gate (her left)', floor: [-gateOffsetM, d.feintGateAtM] },
        { name: 'right gate (her right)', floor: [gateOffsetM, d.feintGateAtM] },
      ];
    case 'L1': {
      const last = d.slalomFirstConeM + 4 * d.slalomSpacingM;
      return [
        { name: 'lane start, her left edge', floor: [-laneHalfWidthM, d.slalomFirstConeM] },
        { name: 'lane start, her right edge', floor: [laneHalfWidthM, d.slalomFirstConeM] },
        { name: 'lane end, her left edge', floor: [-laneHalfWidthM, last] },
        { name: 'lane end, her right edge', floor: [laneHalfWidthM, last] },
      ];
    }
    case 'L3': {
      const s = d.receiveBoxSideM / 2;
      return [
        { name: 'box far-left corner', floor: [-s, -s] },
        { name: 'box far-right corner', floor: [s, -s] },
        { name: 'box near-left corner', floor: [-s, s] },
        { name: 'box near-right corner', floor: [s, s] },
      ];
    }
    case 'L4': {
      const s = d.masterySquareM / 2;
      return [
        { name: 'square far-left corner', floor: [-s, -s] },
        { name: 'square far-right corner', floor: [s, -s] },
        { name: 'square near-left corner', floor: [-s, s] },
        { name: 'square near-right corner', floor: [s, s] },
      ];
    }
  }
}

/** Zones the parent marks per drill family (task 15). The first is the area used for the camera activity check. */
export const FAMILY_ZONES: Record<'L1' | 'L2' | 'L3' | 'L4', { zones: string[]; tripwire: boolean }> = {
  L2: { zones: ['lane', 'her-left gate', 'her-right gate', 'stop zone'], tripwire: true },
  L1: { zones: ['lane', 'her-left lane edge', 'her-right lane edge', 'stop zone'], tripwire: true },
  L3: { zones: ['receive box', 'her-left gate', 'her-right gate', 'back gate'], tripwire: false },
  L4: { zones: ['square'], tripwire: false },
};
