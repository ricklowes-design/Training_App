# Packs levelled pose landmarks (from level.py) into the committed motion format:
# 19 joints, millimetres as whole numbers, scene axes (x = right as the camera sees it,
# y = up with the lowest foot point on the floor, z = toward the camera), hip centre at x = z = 0.
# Usage: python pack.py level.json out.json "<take description>"
import sys, json, numpy as np
src, out, desc = sys.argv[1:4]
d = json.load(open(src))
L = np.array(d['L'])  # MediaPipe world axes: x right, y down, z away from the camera
IDX = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
NAMES = ['nose', 'leftEar', 'rightEar', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist',
         'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftToe', 'rightToe']
P = np.stack([L[..., 0], -L[..., 1], -L[..., 2]], -1)[:, IDX]
feet = [NAMES.index(n) for n in ['leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftToe', 'rightToe']]
P[..., 1] -= P[:, feet, 1].min(1)[:, None]
q = np.rint(P * 1000).astype(int)
json.dump({
    'format': 'defender-motion/1',
    'description': desc,
    'fps': round(d['fps']),
    'frameCount': len(q),
    'units': 'mm',
    'axes': 'x right as the camera sees it, y up (lowest foot point = 0), z toward the camera; hip centre at x = z = 0',
    'joints': NAMES,
    'note': "left/right are the performer's own sides",
    'frames': q.reshape(len(q), -1).tolist(),
}, open(out, 'w'), separators=(',', ':'))
print(out, q.shape)
