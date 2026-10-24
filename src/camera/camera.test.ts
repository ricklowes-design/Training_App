import { describe, expect, it } from 'vitest';
import { applyH, calibrationCones, homography, pointInPolygon, polygonMask } from './geometry';
import { bestShift, framingCheck, motionFraction, ncc, type Gray } from './frames';

describe('floor calibration', () => {
  it('maps the four tapped cones back to their floor positions, and points between them', () => {
    // A camera at the lane end looking down the lane: perspective squeezes far points.
    const floor: [number, number][] = [[0, 0.5], [0, 3.0], [-0.8, 4.2], [0.8, 4.2]];
    const project = ([x, y]: [number, number]): [number, number] => [0.5 + (0.4 * x) / (6.5 - y), 0.15 + 0.7 * (1 - 1 / (6.5 - y))];
    const img = floor.map(project);
    const h = homography(img, floor)!;
    for (let i = 0; i < 4; i++) {
      const [x, y] = applyH(h, img[i]);
      expect(x).toBeCloseTo(floor[i][0], 6);
      expect(y).toBeCloseTo(floor[i][1], 6);
    }
    // A cone at a known spot (0.4, 2.0) reads back within 10 cm.
    const [x, y] = applyH(h, project([0.4, 2.0]));
    expect(Math.hypot(x - 0.4, y - 2.0)).toBeLessThan(0.1);
  });

  it('refuses three collinear points', () => {
    expect(homography([[0, 0], [0.5, 0.5], [1, 1], [0, 1]], [[0, 0], [1, 1], [2, 2], [0, 1]])).toBeNull();
  });

  it('cone positions come from the room layout', () => {
    const d = { slalomFirstConeM: 0.8, slalomSpacingM: 1, feintConeM: 3, feintGateAtM: 4.2, feintGateWidthM: 0.8, receiveBoxSideM: 1.5, masterySquareM: 1 };
    expect(calibrationCones('L2', d).map((c) => c.floor)).toEqual([[0, 0.5], [0, 3], [-0.8, 4.2], [0.8, 4.2]]);
  });
});

describe('zones', () => {
  const square = [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.75 }];
  it('point in polygon', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 0.1, y: 0.5 }, square)).toBe(false);
  });
  it('mask covers the polygon', () => {
    const m = polygonMask(square, 20, 20);
    expect(m.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

const frame = (w: number, h: number, f: (x: number, y: number) => number): Gray => {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { w, h, data };
};
const scene = (ox = 0, oy = 0, light = 1) => frame(64, 36, (x, y) => Math.min(255, light * (100 + 60 * Math.sin((x + ox) / 3) + 50 * Math.cos((y + oy) / 4))));

describe('frames', () => {
  it('motion only counts changed pixels inside the mask', () => {
    const a = frame(10, 10, () => 100);
    const b = frame(10, 10, (x) => (x < 5 ? 200 : 100));
    expect(motionFraction(a, b, null)).toBeCloseTo(0.5);
    const right = new Uint8Array(100).map((_, i) => (i % 10 >= 5 ? 1 : 0));
    expect(motionFraction(a, b, right)).toBe(0);
  });

  it('identical pictures correlate at 1', () => {
    expect(ncc(scene(), scene())).toBeCloseTo(1, 6);
  });

  it('finds how far the picture moved', () => {
    const s = bestShift(scene(), scene(4, 0), 6);
    expect(s.dx).toBe(-4);
    expect(s.dy).toBe(0);
  });

  it('framing check: green when unchanged, red with a fix when moved or dark', () => {
    expect(framingCheck(scene(), scene()).ok).toBe(true);
    const moved = framingCheck(scene(), scene(5, 0));
    expect(moved.ok).toBe(false);
    expect(moved.message).toMatch(/^Camera has moved: turn the camera/);
    expect(framingCheck(scene(), scene(0, 0, 0.2)).message).toMatch(/Too dark/);
  });
});
