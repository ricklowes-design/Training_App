import { describe, expect, it } from 'vitest';
import type { TrackSample } from '../ball/track';
import type { FrameData } from './compute';
import { slalomRuns, vPullWindows } from './outcome';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const polygons = { 'stop zone': rect(0.4, 0.0, 0.6, 0.2), 'her-left lane edge': rect(0.0, 0.2, 0.3, 1), 'her-right lane edge': rect(0.7, 0.2, 1, 1) };
const frame = (tMs: number, zones: Record<string, number> = {}): FrameData => ({ tMs, area: 0.1, zones });

describe('slalom outcome (plan/12 §12.3)', () => {
  it('times start tone to the stop zone and counts lane-edge entries from motion', () => {
    const frames: FrameData[] = [];
    for (let t = 0; t <= 14_000; t += 66) {
      const z: Record<string, number> = {};
      if (t >= 9_800 && t < 10_400) z['stop zone'] = 0.2; // first run reaches the stop zone at 9.8 s
      if (t >= 4_000 && t < 4_400) z['her-left lane edge'] = 0.2; // one lane-edge entry
      frames.push(frame(t, z));
    }
    const [run] = slalomRuns(frames, [{ label: 'Pattern R', startMs: 0, endMs: 10_000 }], { stopZone: 'stop zone', edges: ['her-left lane edge', 'her-right lane edge'], polygons });
    expect(run).toMatchObject({ status: 'estimate', source: 'motion', laneEdgeEntries: 1 });
    expect(run.timeS).toBeCloseTo(9.8, 1);
  });

  it('prefers the tracked ball, and says when no stop-zone event was seen', () => {
    const track: TrackSample[] = [];
    for (let t = 0; t <= 9_000; t += 66) track.push({ tMs: t, x: 0.5 + (t > 3_000 && t < 3_400 ? 0.3 : 0), y: Math.max(0.1, 0.95 - t / 10_000), confidence: 0.9, predicted: false });
    const [run] = slalomRuns([], [{ label: 'Pattern R', startMs: 0, endMs: 9_000 }], { stopZone: 'stop zone', edges: ['her-left lane edge', 'her-right lane edge'], polygons, track });
    expect(run.source).toBe('ball');
    expect(run.status).toBe('estimate');
    expect(run.laneEdgeEntries).toBe(1);
    const none = slalomRuns([frame(1000)], [{ label: 'Pattern L', startMs: 0, endMs: 5000 }], { stopZone: 'stop zone', edges: [], polygons });
    expect(none[0]).toMatchObject({ status: 'unableToAssess', reason: 'no stop-zone event seen' });
  });
});

describe('V-pulls outcome', () => {
  const square = rect(0.3, 0.3, 0.7, 0.7);
  it('counts direction reversals inside the square and balls lost from it', () => {
    const track: TrackSample[] = [];
    // Back and forth every 0.5 s for 30 s (60 reversals), leaving the square once for 0.6 s.
    for (let t = 0; t <= 30_000; t += 66) {
      const phase = Math.floor(t / 500) % 2;
      const within = (t % 500) / 500;
      const x = 0.4 + 0.2 * (phase ? 1 - within : within);
      const out = t > 10_000 && t < 10_600;
      track.push({ tMs: t, x: out ? 0.8 : x, y: 0.5, confidence: 0.9, predicted: false });
    }
    const [w] = vPullWindows([{ label: 'Right foot', startMs: 0, endMs: 30_000 }], square, track, 15);
    expect(w.status).toBe('estimate');
    expect(w.lostBall).toBe(1);
    expect(w.reversals).toBeGreaterThan(50);
    expect(w.reversals).toBeLessThanOrEqual(60);
  });
  it('is unable to assess without ball tracking or when the ball was rarely seen', () => {
    expect(vPullWindows([{ label: 'Right foot', startMs: 0 }], square, undefined, 15)[0]).toMatchObject({ status: 'unableToAssess', reason: 'needs ball tracking' });
    const sparse: TrackSample[] = [{ tMs: 1000, x: 0.5, y: 0.5, confidence: 0.9, predicted: false }];
    expect(vPullWindows([{ label: 'Right foot', startMs: 0, endMs: 30_000 }], square, sparse, 15)[0].status).toBe('unableToAssess');
  });
});

describe('rapid contacts (experimental, task 6.7)', () => {
  const square = [
    { x: 0.3, y: 0.3 },
    { x: 0.7, y: 0.3 },
    { x: 0.7, y: 0.7 },
    { x: 0.3, y: 0.7 },
  ];
  it('counts quick side-to-side taps, with a range between the two methods', async () => {
    const { tapWindows } = await import('./outcome');
    const track: TrackSample[] = [];
    // A tap every 0.3 s for 10 s (about 33 touches), seen at 30 fps.
    for (let t = 0; t <= 10_000; t += 33) {
      const k = Math.floor(t / 300);
      const within = (t % 300) / 300;
      track.push({ tMs: t, x: 0.5 + 0.03 * (k % 2 ? 1 - within : within) - 0.015, y: 0.5, confidence: 0.9, predicted: false });
    }
    const [w] = tapWindows([{ label: 'Inside-outside taps', startMs: 0, endMs: 10_000 }], square, track, 30);
    expect(w.status).toBe('experimental');
    expect(w.contacts).toBeGreaterThanOrEqual(28);
    expect(w.contacts).toBeLessThanOrEqual(36);
    expect(w.range![0]).toBeLessThanOrEqual(w.contacts!);
  });
  it('is unobservable when the feet hide the ball too much', async () => {
    const { tapWindows } = await import('./outcome');
    const track: TrackSample[] = [];
    for (let t = 0; t <= 10_000; t += 33) track.push({ tMs: t, x: 0.5, y: 0.5, confidence: 0.9, predicted: t % 1000 > 400 });
    expect(tapWindows([{ label: 'Outside-only taps', startMs: 0, endMs: 10_000 }], square, track, 30)[0].status).toBe('unobservable');
  });
});
