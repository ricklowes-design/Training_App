import { describe, expect, it } from 'vitest';
import { assignCones, colourAt, findCones, ORANGE } from './cones';

const W = 200;
const H = 120;
/** A green floor with small orange triangles (cones) and one big orange rug. */
function photo(cones: [number, number][], rug = false): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = 4 * (y * W + x);
      let c = [60, 110, 70];
      for (const [cx, by] of cones) if (y <= by && y >= by - 6 && Math.abs(x - cx) <= (y - (by - 6)) / 2) c = [235, 115, 25];
      if (rug && x >= 120 && x < 190 && y >= 80 && y < 115) c = [230, 110, 30];
      d.set([c[0], c[1], c[2], 255], k);
    }
  return d;
}

describe('cone detection (experimental)', () => {
  it('finds each cone at its base and ignores a large orange rug', () => {
    const found = findCones(photo([[50, 60], [100, 40], [150, 60]], true), W, H, ORANGE);
    expect(found).toHaveLength(3);
    const xs = found.map((f) => f.base.x * W).sort((a, b) => a - b);
    [50, 100, 150].forEach((x, i) => expect(Math.abs(xs[i] - x)).toBeLessThanOrEqual(1));
    for (const f of found) expect([40, 60]).toContain(Math.round(f.base.y * H - 0.5));
  });
  it('only inside the safe floor when one is drawn', () => {
    const poly = [{ x: 0, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 1 }, { x: 0, y: 1 }];
    expect(findCones(photo([[50, 60], [150, 60]]), W, H, ORANGE, poly)).toHaveLength(1);
  });
  it('learns another cone colour from a tap', () => {
    const img = photo([[50, 60]]);
    const m = colourAt(img, W, H, { x: 50 / W, y: 58 / H }, 1);
    expect(m.h).toBeCloseTo(ORANGE.h, 1);
  });
  it('matches markers to the nearest cones; far or missing cones leave the marker where it was', () => {
    const r = assignCones([{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }], [{ x: 0.52, y: 0.48 }, { x: 0.23, y: 0.55 }]);
    expect(r[0]).toEqual({ x: 0.23, y: 0.55 });
    expect(r[1]).toEqual({ x: 0.52, y: 0.48 });
    expect(r[2]).toBeNull();
  });
});
