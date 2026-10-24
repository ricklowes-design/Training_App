// Colour model for a registered ball (part 17 BR-01). HSV on 0..1 scales; hue is circular.

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export const hueDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

export interface ColourModel {
  h: number;
  s: number;
  v: number;
  hSpread: number;
  sSpread: number;
  vSpread: number;
}

/** Mean and spread of a set of pixels; low-saturation balls (white) are matched on value instead of hue. */
export function fitColour(px: Hsv[]): ColourModel {
  const n = Math.max(1, px.length);
  // Circular mean of hue.
  const cx = px.reduce((a, p) => a + Math.cos(2 * Math.PI * p.h), 0) / n;
  const cy = px.reduce((a, p) => a + Math.sin(2 * Math.PI * p.h), 0) / n;
  let h = Math.atan2(cy, cx) / (2 * Math.PI);
  if (h < 0) h += 1;
  const s = px.reduce((a, p) => a + p.s, 0) / n;
  const v = px.reduce((a, p) => a + p.v, 0) / n;
  const sd = (f: (p: Hsv) => number) => Math.sqrt(px.reduce((a, p) => a + f(p) ** 2, 0) / n);
  return {
    h,
    s,
    v,
    hSpread: Math.max(0.03, 2.5 * sd((p) => hueDist(p.h, h))),
    sSpread: Math.max(0.08, 2.5 * sd((p) => p.s - s)),
    vSpread: Math.max(0.1, 2.5 * sd((p) => p.v - v)),
  };
}

export function matches(m: ColourModel, p: Hsv): boolean {
  const lowSat = m.s < 0.2;
  if (Math.abs(p.s - m.s) > m.sSpread || Math.abs(p.v - m.v) > m.vSpread) return false;
  return lowSat || hueDist(p.h, m.h) <= m.hSpread;
}
