// Model files and their pinned versions. Kept apart from pose.ts so the main thread can name the
// versions without loading MediaPipe.

// Pinned model versions (not /latest/), so scores cannot change without a code change (audit task 7).
// Hosted with the app under models/ (owner decision 2026-10-30; checksums in public/models/README.md),
// so analysis works offline and nothing is fetched from Google. Paths are relative to the site root.
export const MODEL_URL = {
  lite: 'models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};
/** The base (non-learning) model versions stored with each analysis. */
export const MODEL_VERSION = { lite: 'pose_landmarker_lite/float16/1', full: 'pose_landmarker_full/float16/1', ball: 'efficientdet_lite0/float16/1' };
export const BALL_MODEL_URL = 'models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

/** A model path as a full URL, from the MediaPipe folder the app serves (`<site>/mediapipe/`). */
export const modelHref = (path: string, wasmBase: string) => new URL(`../${path}`, wasmBase).href;
