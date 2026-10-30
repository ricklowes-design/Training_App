/// <reference lib="webworker" />
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { polygonMask } from '../camera/geometry';
import { motionFraction, toGray, type Gray } from '../camera/frames';
import type { CueLogEntry } from '../cue/engine';
import type { Pt } from '../db/types';
import { analyseBlock, analyseReps, type AnalysisContext, type FrameData } from './compute';
import { slalomRuns, tapWindows, vPullWindows, type Window } from './outcome';
import { boxesToDetections, createBallDetector, createPose, detectRoomObjects, toPose } from './pose';
import type { ColourModel } from '../ball/colour';
import { detectBall, sizeModel, type SizeModel } from '../ball/detect';
import { BallTracker } from '../ball/track';
import { summarise, type BallSummary } from '../ball/summary';

// All camera analysis runs here, never on the main thread (CLAUDE.md).

const W = 64;
const H = 36;
let canvas: OffscreenCanvas | null = null;
let masks: { name: string; mask: Uint8Array }[] = [];
let areaName = '';
let prev: Gray | null = null;
let frames: FrameData[] = [];
let landmarker: PoseLandmarker | null = null;
let lastTs = -1;
let started = 0;
// Ball tracking (part 17), only with a registered profile and the flag on.
const BW = 160;
const BH = 90;
let ball: { colour?: ColourModel; size: SizeModel; profileId: string; tracker: BallTracker; canvas: OffscreenCanvas; frames: number } | null = null;
let ballDetector: import('@mediapipe/tasks-vision').ObjectDetector | null = null;
let lastBallTs = -1;
let zonesAll: { name: string; polygon: Pt[] }[] = [];

export type ToWorker =
  | {
      type: 'init';
      pose: 'off' | 'lite' | 'full';
      wasmBase: string;
      zones: { name: string; polygon: Pt[] }[];
      ball?: { profileId: string; colour?: ColourModel; sizeSamples: { y: number; diameterPx: number }[]; width: number; neural?: boolean };
    }
  | { type: 'frame'; tMs: number; bitmap: ImageBitmap }
  | { type: 'finish'; log: CueLogEntry[]; ctx: AnalysisContext; gateZones: string[]; windows?: Window[]; rapid?: boolean }
  | { type: 'bench'; model: 'lite' | 'full'; wasmBase: string; bitmaps: ImageBitmap[]; fps: number }
  | { type: 'benchBall'; wasmBase: string; bitmaps: ImageBitmap[]; fps: number }
  | { type: 'detectRoom'; wasmBase: string; bitmap: ImageBitmap };

export type FromWorker =
  | { type: 'ready'; poseUsed: boolean; error?: string }
  | { type: 'ack' }
  | { type: 'result'; reps: ReturnType<typeof analyseReps>; block: ReturnType<typeof analyseBlock>; ball?: BallSummary }
  | { type: 'bench'; model: 'lite' | 'full'; fps: number; delegate: string; frames: number; detected: number }
  | { type: 'benchBall'; fps: number; delegate: string; frames: number; detected: number }
  | { type: 'room'; items: { label: string; score: number; box: { x: number; y: number; w: number; h: number } }[] }
  | { type: 'error'; message: string };

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

function gray(bitmap: ImageBitmap): Gray {
  canvas = canvas ?? new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, W, H);
  return toGray(ctx.getImageData(0, 0, W, H).data, W, H);
}

let skippedFrames = 0;

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      masks = m.zones.filter((z) => z.polygon.length >= 3).map((z) => ({ name: z.name, mask: polygonMask(z.polygon, W, H) }));
      areaName = m.zones[0]?.name ?? '';
      zonesAll = m.zones;
      ball = m.ball ? { colour: m.ball.colour, size: sizeModel(m.ball.sizeSamples, m.ball.width), profileId: m.ball.profileId, tracker: new BallTracker(), canvas: new OffscreenCanvas(BW, BH), frames: 0 } : null;
      frames = [];
      skippedFrames = 0;
      prev = null;
      lastTs = -1;
      started = performance.now();
      let error: string | undefined;
      ballDetector = null;
      lastBallTs = -1;
      if (m.ball?.neural) {
        try {
          ballDetector = (await createBallDetector(m.wasmBase)).detector;
        } catch (e) {
          error = [error, `ball detector could not load: ${e instanceof Error ? e.message : String(e)}`].filter(Boolean).join('; ');
        }
      }
      if (m.pose !== 'off') {
        try {
          landmarker = (await createPose(m.pose, m.wasmBase)).landmarker;
        } catch (e) {
          landmarker = null;
          error = [error, `pose model could not load: ${e instanceof Error ? e.message : String(e)}`].filter(Boolean).join('; ');
        }
      }
      post({ type: 'ready', poseUsed: !!landmarker, error });
    } else if (m.type === 'frame') {
      const g = gray(m.bitmap);
      const zones: Record<string, number> = {};
      let area = 0;
      if (prev) {
        for (const z of masks) zones[z.name] = motionFraction(prev, g, z.mask);
        area = zones[areaName] ?? motionFraction(prev, g, null);
      }
      prev = g;
      let pose = undefined;
      if (landmarker && m.tMs > lastTs) {
        pose = toPose(landmarker.detectForVideo(m.bitmap, m.tMs).landmarks[0]);
        lastTs = m.tMs;
      }
      if (ball) {
        const ctx = ball.canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(m.bitmap, 0, 0, BW, BH);
        const dets = ball.colour ? detectBall(ctx.getImageData(0, 0, BW, BH).data, BW, BH, ball.colour, ball.size) : [];
        // The model's boxes join the colour candidates; the tracker keeps the one that fits the track.
        if (ballDetector && m.tMs > lastBallTs) {
          dets.push(...boxesToDetections(ballDetector.detectForVideo(m.bitmap, m.tMs).detections, m.bitmap.width, m.bitmap.height));
          lastBallTs = m.tMs;
        }
        ball.tracker.update(m.tMs, dets);
        ball.frames++;
      }
      m.bitmap.close();
      frames.push({ tMs: m.tMs, area, zones, pose });
      post({ type: 'ack' });
    } else if (m.type === 'finish') {
      const reps = analyseReps(frames, m.log, m.ctx, m.gateZones);
      const block = analyseBlock(reps, { poseUsed: !!landmarker, analysedFps: m.ctx.fps, analysisMs: Math.round(performance.now() - started) });
      if (skippedFrames) block.skippedFrames = skippedFrames;
      // Slalom runs and V-pull windows (plan/12 §12.3).
      const polygons = Object.fromEntries(zonesAll.map((z) => [z.name, z.polygon]));
      if (m.windows?.length && m.ctx.kind === 'slalom')
        block.slalom = slalomRuns(frames, m.windows, { stopZone: 'stop zone', edges: zonesAll.map((z) => z.name).filter((n) => n.includes('lane edge')), polygons, track: ball?.tracker.track });
      if (m.windows?.length && m.ctx.kind === 'control') {
        const vp = m.windows.filter((w) => w.label.startsWith('V-pulls') || w.label.endsWith('foot'));
        const taps = m.windows.filter((w) => /taps/i.test(w.label));
        if (vp.length) block.vPulls = vPullWindows(vp, polygons['square'], ball?.tracker.track, m.ctx.fps);
        if (taps.length && m.rapid) block.taps = tapWindows(taps, polygons['square'], ball?.tracker.track, m.ctx.fps);
      }
      const ballSummary = ball ? summarise(ball.tracker.track, ball.frames, zonesAll.slice(1), ball.profileId, ball.colour ? (ballDetector ? 'colour+model' : 'colour') : 'model') : undefined;
      ball = null;
      ballDetector?.close();
      ballDetector = null;
      landmarker?.close();
      landmarker = null;
      frames = [];
      post({ type: 'result', reps, block, ball: ballSummary });
    } else if (m.type === 'detectRoom') {
      post({ type: 'room', items: await detectRoomObjects(m.wasmBase, m.bitmap) });
    } else if (m.type === 'benchBall') {
      const { detector, delegate } = await createBallDetector(m.wasmBase);
      detector.detectForVideo(m.bitmaps[0], 0); // warm-up
      let detected = 0;
      const t0 = performance.now();
      m.bitmaps.forEach((b, i) => {
        if (detector.detectForVideo(b, Math.round(((i + 1) * 1000) / m.fps)).detections.length) detected++;
      });
      const secs = (performance.now() - t0) / 1000;
      detector.close();
      post({ type: 'benchBall', fps: Math.round((10 * m.bitmaps.length) / secs) / 10, delegate, frames: m.bitmaps.length, detected });
    } else if (m.type === 'bench') {
      const { landmarker: lm, delegate } = await createPose(m.model, m.wasmBase);
      lm.detectForVideo(m.bitmaps[0], 0); // warm-up
      let detected = 0;
      const t0 = performance.now();
      m.bitmaps.forEach((b, i) => {
        if (lm.detectForVideo(b, Math.round(((i + 1) * 1000) / m.fps)).landmarks.length) detected++;
      });
      const secs = (performance.now() - t0) / 1000;
      lm.close();
      post({ type: 'bench', model: m.model, fps: Math.round((10 * m.bitmaps.length) / secs) / 10, delegate, frames: m.bitmaps.length, detected });
    }
  } catch (e) {
    // One bad frame is skipped, not fatal: free it and acknowledge, so the sender never waits forever (audit task 7).
    if (m.type === 'frame') {
      try {
        m.bitmap.close();
      } catch {
        /* already closed */
      }
      skippedFrames++;
      post({ type: 'ack' });
      return;
    }
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
