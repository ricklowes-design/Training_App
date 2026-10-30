import { describe, expect, it, vi } from 'vitest';
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

describe('camera choice and errors (audit 2026-10-29, task 5)', () => {
  const dev = (deviceId: string, label: string) => ({ deviceId, label, kind: 'videoinput', groupId: '', toJSON: () => ({}) }) as MediaDeviceInfo;

  it('a missing saved camera falls back to the USB webcam, not the built-in one', async () => {
    const { preferredCamera } = await import('./session');
    const list = [dev('a', 'Integrated Camera (04f2:b6dd)'), dev('b', 'USB Video Device')];
    expect(preferredCamera(list, 'gone')?.deviceId).toBe('b');
    expect(preferredCamera(list, 'a')?.deviceId).toBe('a');
  });

  it('turns camera errors into plain words', async () => {
    const { cameraErrorText } = await import('./session');
    const err = (name: string) => Object.assign(new Error('x'), { name });
    expect(cameraErrorText(err('NotAllowedError'))).toMatch(/^Chrome is blocking the camera/);
    expect(cameraErrorText(err('NotFoundError'))).toMatch(/^No webcam found/);
    expect(cameraErrorText(err('OverconstrainedError'))).toMatch(/^No webcam found/);
    expect(cameraErrorText(err('NotReadableError'))).toMatch(/^The webcam is busy/);
    expect(cameraErrorText(new Error('odd'))).toBe('Camera not available (odd).');
  });
});

describe('recording survives the camera going away (audit 2026-10-29, task 6)', () => {
  const fakeSession = async (rec: { state: string; mimeType: string; stop: () => void }, stopped: Promise<void>) => {
    const { CameraSession } = await import('./session');
    const cs = Object.create(CameraSession.prototype) as Record<string, unknown>;
    Object.assign(cs, { recorder: rec, stopped, chunks: [new Blob(['x'])], presence: { samples: 0, present: 0 }, loopId: 0 });
    return cs as unknown as import('./session').CameraSession;
  };

  it('endBlock resolves when Chrome already stopped the recorder', async () => {
    const cs = await fakeSession({ state: 'inactive', mimeType: 'video/webm', stop: () => undefined }, Promise.resolve());
    const out = await cs.endBlock();
    expect(out.blob.size).toBe(1);
  });

  it('endBlock gives up after 3 s when the recorder never reports stopping', async () => {
    vi.useFakeTimers();
    const cs = await fakeSession({ state: 'recording', mimeType: 'video/webm', stop: () => undefined }, new Promise<void>(() => undefined));
    const p = cs.endBlock();
    await vi.advanceTimersByTimeAsync(3100);
    await expect(p).resolves.toMatchObject({ mime: 'video/webm' });
    vi.useRealTimers();
  });
});
