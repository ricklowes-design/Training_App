import { describe, expect, it } from 'vitest';
import { fitColour, matches, rgbToHsv } from './colour';
import { detectBall, sizeModel } from './detect';
import { gateEvents, touches } from './events';
import { BallTracker, type TrackSample } from './track';

const W = 160;
const H = 90;
/** Grey-green floor with an orange disc (and optionally an orange box as a similar object). */
function frame(cx: number, cy: number, r: number, box = false): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = 4 * (y * W + x);
      const inBall = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const inBox = box && x >= 10 && x < 40 && y >= 10 && y < 18;
      const [R, G, B] = inBall || inBox ? [235, 120, 30] : [70 + ((x * 7 + y * 3) % 20), 100, 70];
      d[k] = R;
      d[k + 1] = G;
      d[k + 2] = B;
      d[k + 3] = 255;
    }
  return d;
}
const orange = fitColour(Array.from({ length: 50 }, (_, i) => rgbToHsv(230 + (i % 10), 115 + (i % 12), 25 + (i % 10))));

describe('ball colour model and detection (BR-01, BR-02)', () => {
  it('matches the ball colour and not the floor', () => {
    expect(matches(orange, rgbToHsv(235, 120, 30))).toBe(true);
    expect(matches(orange, rgbToHsv(75, 100, 70))).toBe(false);
  });
  it('finds a round ball and rejects a same-coloured box of the wrong shape and size', () => {
    const size = sizeModel([{ y: 0.5, diameterPx: 12 * 8 }], W * 8);
    const dets = detectBall(frame(100, 50, 6, true), W, H, orange, size);
    expect(dets[0].x).toBeCloseTo(100.5 / W, 2);
    expect(dets[0].y).toBeCloseTo(50.5 / H, 2);
    expect(dets[0].confidence).toBeGreaterThan(0.6);
    const box = dets.find((d) => d.x < 0.3);
    expect(!box || box.confidence < dets[0].confidence).toBe(true);
  });
});

describe('tracking (BR-02)', () => {
  it('bridges a short occlusion with predicted samples, flagged, and ignores a far similar object', () => {
    const t = new BallTracker();
    for (let i = 0; i < 6; i++) t.update(i * 33, [{ x: 0.2 + i * 0.01, y: 0.5, diameter: 0.05, confidence: 0.9 }]);
    const p = t.update(6 * 33, []); // occluded
    expect(p?.predicted).toBe(true);
    expect(p!.x).toBeCloseTo(0.26, 2);
    const s = t.update(7 * 33, [{ x: 0.9, y: 0.1, diameter: 0.05, confidence: 0.95 }, { x: 0.27, y: 0.5, diameter: 0.05, confidence: 0.7 }]);
    expect(s?.predicted).toBe(false);
    expect(s!.x).toBeCloseTo(0.27);
  });
  it('a long occlusion ends the track instead of inventing positions', () => {
    const t = new BallTracker();
    t.update(0, [{ x: 0.5, y: 0.5, diameter: 0.05, confidence: 0.9 }]);
    t.update(33, [{ x: 0.51, y: 0.5, diameter: 0.05, confidence: 0.9 }]);
    let last: TrackSample | null = null;
    for (let ms = 66; ms <= 600; ms += 33) last = t.update(ms, []);
    expect(last).toBeNull();
  });
});

const seen = (pts: [number, number, number][]): TrackSample[] => pts.map(([tMs, x, y]) => ({ tMs, x, y, confidence: 0.9, predicted: false }));

describe('gate events (BR-03)', () => {
  const gate = { name: 'left gate', a: { x: 0.3, y: 0.5 }, b: { x: 0.5, y: 0.5 } };
  it('counts one forward crossing between the cones, with hysteresis and no duplicates', () => {
    const jitter = seen([[0, 0.4, 0.6], [33, 0.4, 0.58], [66, 0.4, 0.52], [99, 0.4, 0.49], [132, 0.4, 0.51], [165, 0.4, 0.48], [198, 0.4, 0.45], [231, 0.4, 0.42]]);
    const ev = gateEvents(jitter, gate);
    expect(ev).toHaveLength(1);
    expect(ev[0].clearance).toBeCloseTo(0.5);
  });
  it('outside the cones is a miss; crossing back is a backward event', () => {
    expect(gateEvents(seen([[0, 0.7, 0.6], [33, 0.7, 0.58], [66, 0.7, 0.42], [99, 0.7, 0.4]]), gate)).toHaveLength(0);
    const ev = gateEvents(seen([[0, 0.4, 0.6], [33, 0.4, 0.58], [66, 0.4, 0.42], [99, 0.4, 0.4], [900, 0.4, 0.4], [1000, 0.4, 0.58], [1033, 0.4, 0.6]]), gate);
    expect(ev.map((e) => e.direction)).toEqual([ev[0].direction, ev[0].direction === 'forward' ? 'backward' : 'forward']);
  });
});

describe('touches (BR-04)', () => {
  it('a sharp turn is a touch; with a foot nearby it is confirmed, else possible; de-duplicated', () => {
    const tr = seen([[0, 0.3, 0.5], [33, 0.32, 0.5], [66, 0.34, 0.5], [99, 0.34, 0.47], [132, 0.34, 0.44], [165, 0.34, 0.41]]);
    const t1 = touches(tr);
    expect(t1).toHaveLength(1);
    expect(t1[0].status).toBe('possible');
    expect(touches(tr, (ms) => Math.abs(ms - 66) < 40)[0].status).toBe('confirmed');
  });
  it('predicted stretches are unobservable: no touch is invented', () => {
    const tr: TrackSample[] = seen([[0, 0.3, 0.5], [33, 0.32, 0.5]]).concat([{ tMs: 66, x: 0.34, y: 0.5, confidence: 0.3, predicted: true }, { tMs: 99, x: 0.34, y: 0.45, confidence: 0.2, predicted: true }]);
    expect(touches(tr)).toHaveLength(0);
  });
});

import { captureAt, sufficiency } from './register';

describe('ball registration (BR-01)', () => {
  it('a tap on the ball captures its pixels and size; a tap on the floor is refused', () => {
    const img = frame(80, 45, 7);
    const c = captureAt(img, W, H, 80, 45, 'stationary')!;
    expect(c.diameterPx).toBeGreaterThanOrEqual(13);
    expect(c.diameterPx).toBeLessThanOrEqual(16);
    expect(captureAt(img, W, H, 5, 80, 'stationary')).toBeNull();
  });
  it('enough varied captures against a distinct background are sufficient', () => {
    const kinds = ['stationary', 'stationary', 'rotating', 'rotating', 'toward', 'away'] as const;
    const caps = kinds.map((k, i) => captureAt(frame(40 + i * 15, 30 + i * 5, 5 + (i % 3)), W, H, 40 + i * 15, 30 + i * 5, k)!);
    const bg = Array.from({ length: 500 }, (_, i) => rgbToHsv(70 + (i % 20), 100, 70));
    const s = sufficiency(caps, bg);
    expect(s.ok).toBe(true);
    const few = sufficiency(caps.slice(0, 2), bg);
    expect(few.ok).toBe(false);
    expect(few.reasons.join(' ')).toMatch(/more capture/);
    const orangeRoom = sufficiency(caps, Array.from({ length: 100 }, () => rgbToHsv(232, 118, 28)));
    expect(orangeRoom.reasons.join(' ')).toMatch(/too much of the ball's colour/);
  });
});
