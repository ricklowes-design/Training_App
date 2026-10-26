// Plane-to-plane mapping (homography) between the floor (metres) and the room photo (0..1).
// Fitted by least squares from four or more known floor points the parent taps on the photo.

export type H = number[]; // 3×3 row-major, h[8] = 1
export type P2 = [number, number];

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-10) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** The homography taking `src` points to `dst` points (≥ 4 pairs, no three on a line), or null. */
export function fitHomography(src: P2[], dst: P2[]): H | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  // Normal equations of the linear (DLT) system with h8 = 1.
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const add = (row: number[], v: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * v;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  src.forEach(([x, y], i) => {
    const [u, v] = dst[i];
    add([x, y, 1, 0, 0, 0, -x * u, -y * u], u);
    add([0, 0, 0, x, y, 1, -x * v, -y * v], v);
  });
  const h = solve(AtA, Atb);
  if (!h || h.some((x) => !Number.isFinite(x))) return null;
  return [...h, 1];
}

export function apply(h: H, [x, y]: P2): P2 | null {
  const w = h[6] * x + h[7] * y + h[8];
  if (Math.abs(w) < 1e-12) return null;
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** The sign of the projective weight: points behind the camera have the opposite sign. */
export const weight = (h: H, [x, y]: P2) => h[6] * x + h[7] * y + h[8];

export function invert(h: H): H | null {
  const [a, b, c, d, e, f, g, i, k] = h;
  const A = e * k - f * i;
  const B = -(d * k - f * g);
  const C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const inv = [A, -(b * k - c * i), b * f - c * e, B, a * k - c * g, -(a * f - c * d), C, -(a * i - b * g), a * e - b * d].map((x) => x / det);
  return inv.map((x) => x / inv[8]);
}

/** Mean distance (in src units) between each src point and its dst point mapped back. */
export function fitError(h: H, src: P2[], dst: P2[]): number {
  const inv = invert(h);
  if (!inv) return Infinity;
  const ds = src.map((s, i) => {
    const p = apply(inv, dst[i]);
    return p ? Math.hypot(p[0] - s[0], p[1] - s[1]) : Infinity;
  });
  return ds.reduce((a, b) => a + b, 0) / Math.max(1, ds.length);
}
