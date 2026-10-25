import sys, json, cv2, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
video, model, out = sys.argv[1:4]
opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.VIDEO, num_poses=1, min_pose_detection_confidence=0.5, min_tracking_confidence=0.5)
det = vision.PoseLandmarker.create_from_options(opts)
cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
frames = []
i = 0
while True:
    ok, im = cap.read()
    if not ok: break
    img = im
    t = int(i * 1000 / fps)
    r = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)), t)
    if r.pose_world_landmarks:
        w = [[round(p.x,4), round(p.y,4), round(p.z,4)] for p in r.pose_world_landmarks[0]]
        n = [[round(p.x,4), round(p.y,4), round(p.visibility,3)] for p in r.pose_landmarks[0]]
        frames.append({'t': t, 'world': w, 'img': n})
    else:
        frames.append({'t': t})
    i += 1
json.dump({'fps': fps, 'w': img.shape[1] if i else 0, 'h': img.shape[0] if i else 0, 'frames': frames}, open(out, 'w'))
print(i, 'frames', sum(1 for f in frames if 'world' in f), 'with pose', img.shape)
