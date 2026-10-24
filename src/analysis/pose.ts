import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Pose } from './compute';

// Pose Landmarker (VIDEO mode) for use inside a worker. GPU delegate when available.

export const MODEL_URL = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
};

export async function createPose(model: 'lite' | 'full', wasmBase: string): Promise<{ landmarker: PoseLandmarker; delegate: 'GPU' | 'CPU' }> {
  const fileset = await FilesetResolver.forVisionTasks(wasmBase, true);
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL[model], delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      return { landmarker, delegate };
    } catch (e) {
      if (delegate === 'CPU') throw e;
    }
  }
  throw new Error('unreachable');
}

/** The few landmarks the analysis uses (BlazePose indices). */
export function toPose(lm: { x: number; y: number; visibility?: number }[] | undefined): Pose | null {
  if (!lm || lm.length < 29) return null;
  const p = (i: number) => ({ x: lm[i].x, y: lm[i].y, v: lm[i].visibility ?? 0 });
  return { nose: p(0), lEye: p(2), rEye: p(5), lShoulder: p(11), rShoulder: p(12), lHip: p(23), rHip: p(24), lAnkle: p(27), rAnkle: p(28) };
}

// Ball detector model (experimental, off by default; part 17 task 6.1). EfficientDet-Lite0 from
// MediaPipe (Apache-2.0), COCO class "sports ball". Downloaded from Google's model storage once.
export const BALL_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/latest/efficientdet_lite0.tflite';

export async function createBallDetector(wasmBase: string): Promise<{ detector: import('@mediapipe/tasks-vision').ObjectDetector; delegate: 'GPU' | 'CPU' }> {
  const { ObjectDetector } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(wasmBase, true);
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      const detector = await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: BALL_MODEL_URL, delegate },
        runningMode: 'VIDEO',
        categoryAllowlist: ['sports ball'],
        scoreThreshold: 0.25,
        maxResults: 3,
      });
      return { detector, delegate };
    } catch (e) {
      if (delegate === 'CPU') throw e;
    }
  }
  throw new Error('unreachable');
}

/** Detector boxes (pixels) as ball detections in picture fractions. */
export function boxesToDetections(dets: { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: { score: number }[] }[], w: number, h: number) {
  return dets
    .filter((d) => d.boundingBox)
    .map((d) => {
      const b = d.boundingBox!;
      return { x: (b.originX + b.width / 2) / w, y: (b.originY + b.height / 2) / h, diameter: Math.max(b.width, b.height) / w, confidence: Math.round(100 * (d.categories[0]?.score ?? 0)) / 100 };
    });
}
