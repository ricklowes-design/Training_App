import { matches, rgbToHsv, type ColourModel } from './colour';

// Ball detection from the registered colour model (part 17 BR-02, first stage). Works on a
// reduced picture (e.g. 160×90): colour mask → connected blobs → size and roundness checks
// against the sizes seen at registration. No neural detector until one passes the licence
// and Chromebook-performance check (task 6.1).

export interface Detection {
  x: number; // 0..1 picture coordinates of the centre
  y: number;
  diameter: number; // 0..1 of the picture width
  confidence: number; // 0..1
}

export interface SizeModel {
  /** Expected apparent diameter (fraction of width) at picture height y, from the registration samples. */
  at(y: number): number | undefined;
}

export function sizeModel(samples: { y: number; diameterPx: number }[], width: number): SizeModel {
  const pts = samples.map((s) => ({ y: s.y, d: s.diameterPx / width })).sort((a, b) => a.y - b.y);
  return {
    at(y) {
      if (!pts.length) return undefined;
      if (pts.length === 1 || y <= pts[0].y) return pts[0].d;
      if (y >= pts[pts.length - 1].y) return pts[pts.length - 1].d;
      const i = pts.findIndex((p) => p.y >= y);
      const a = pts[i - 1];
      const b = pts[i];
      return a.d + ((b.d - a.d) * (y - a.y)) / (b.y - a.y || 1);
    },
  };
}

export function detectBall(rgba: Uint8ClampedArray, w: number, h: number, colour: ColourModel, size?: SizeModel): Detection[] {
  const mask = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) mask[i] = matches(colour, rgbToHsv(rgba[j], rgba[j + 1], rgba[j + 2])) ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const out: Detection[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w;
      const y = (k / w) | 0;
      n++;
      sx += x;
      sy += y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const q of [k - 1, k + 1, k - w, k + w]) {
        if (q < 0 || q >= mask.length || seen[q] || !mask[q]) continue;
        if ((q === k - 1 && x === 0) || (q === k + 1 && x === w - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (n < 4) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const fill = n / (bw * bh); // a disc fills about 0.785 of its box
    const aspect = Math.min(bw, bh) / Math.max(bw, bh);
    const roundness = Math.max(0, 1 - Math.abs(fill - 0.785) / 0.4) * aspect;
    const diameter = Math.max(bw, bh) / w;
    const cy = (sy / n + 0.5) / h;
    const want = size?.at(cy);
    const sizeFit = want ? Math.max(0, 1 - Math.abs(diameter - want) / want) : 0.6;
    const confidence = Math.round(100 * roundness * (0.4 + 0.6 * sizeFit)) / 100;
    if (confidence < 0.2) continue;
    out.push({ x: (sx / n + 0.5) / w, y: cy, diameter, confidence });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
