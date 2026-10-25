# Defender motion data

Joint movement extracted from two recordings of an adult volunteer acting as a defender,
made by the family for this app, with permission to use the movement in it. Only the joint
positions are kept: no video, images or face detail (the nose and ears are kept only to
orient the head). The source videos are not in this repository and must never be added.

Not yet used by the app. It is the source for the realistic defender's animation clips
(cut into moves, mirrored for left/right, foot-locked, blended) to be built behind a
feature flag, with the current defender kept as the fallback.

| File | Length | Recording | Moves |
|---|---|---|---|
| `take1.json` | 15 s, 458 frames | handheld phone, tilted (17° corrected), socks | six commits alternating sides; the last (13–14.5 s) a hip turn to chase |
| `take2.json` | 90 s, 2,692 frames | fixed phone (6.7° corrected), boots | 0–17 s small commits and shuffles; 17–50 s wide lunges, drop steps and hip turns, deep lunges at 46–49 s; 50–75 s quick jabs and approach steps; 75–90 s turns to chase both ways |

## Format (`defender-motion/1`)
- `frames[i]` holds 19 joints × (x, y, z) in millimetres, in the order of `joints`.
- Axes: x right as the camera sees it, y up with the lowest foot point on the floor (0),
  z toward the camera. The hip centre is at x = z = 0 in every frame (no travel; the app
  adds travel by locking the planted foot). The performer faces the camera, so their left
  side has the larger x.
- `left`/`right` in joint names are the performer's own sides.
- Depth (z) is estimated from a single camera and is the least reliable axis.

## How it was made
`scripts/motion/`: `extract.py` (MediaPipe Pose Landmarker, heavy model, world landmarks,
every frame) → `level.py` (5-frame smoothing, camera tilt removed so the legs point down on
average) → `pack.py` (19 joints, scene axes, millimetres). Python with `mediapipe`,
`opencv-python-headless`, `numpy` and `matplotlib`.
