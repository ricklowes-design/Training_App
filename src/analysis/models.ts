// Model files and their pinned versions. Kept apart from pose.ts so the main thread can name the
// versions without loading MediaPipe.

// Pinned model versions (not /latest/), so scores cannot change without a code change (audit task 7).
export const MODEL_URL = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};
/** The base (non-learning) model versions stored with each analysis. */
export const MODEL_VERSION = { lite: 'pose_landmarker_lite/float16/1', full: 'pose_landmarker_full/float16/1', ball: 'efficientdet_lite0/float16/1' };
export const BALL_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
