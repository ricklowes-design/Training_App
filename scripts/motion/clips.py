# Builds the defender's motion clips (src/defender/mocap/clips.json) from a packed take
# (assets/defender-motion/take2.json): one guard loop, and for each loaded lunge a commit clip
# (guard -> lowest point) and its recover clip (back to guard). Sides are the player's view
# (the performer faces the camera, so camera right = player's right). Each clip carries the
# body's lateral travel, found by keeping the planted foot still. The app mirrors every move to
# get the other side. Usage: python clips.py take2.json clips.json
import sys, json, numpy as np
src, out = sys.argv[1:3]
d = json.load(open(src)); n = d['frameCount']; J = d['joints']
F = np.array(d['frames'], float).reshape(n, 19, 3) / 1000
ix = {k: i for i, k in enumerate(J)}
LF = [ix[k] for k in ['leftAnkle', 'leftHeel', 'leftToe']]
RF = [ix[k] for k in ['rightAnkle', 'rightHeel', 'rightToe']]
hip = (F[:, ix['leftHip']] + F[:, ix['rightHip']]) / 2
ank = (F[:, ix['leftAnkle']] + F[:, ix['rightAnkle']]) / 2
stance = np.abs(F[:, ix['leftAnkle'], 0] - F[:, ix['rightAnkle'], 0])
shift = (hip[:, 0] - ank[:, 0]) / np.maximum(stance, 0.05)
yaw = np.degrees(np.arctan2(F[:, ix['leftHip'], 2] - F[:, ix['rightHip'], 2], F[:, ix['leftHip'], 0] - F[:, ix['rightHip'], 0]))
hipH = hip[:, 1]
v = np.r_[0, np.linalg.norm(np.diff(F.reshape(n, -1), axis=0), axis=1)]
vs = np.convolve(v, np.ones(9) / 9, 'same')
quiet = vs < np.percentile(vs, 30)

def travel(a, b):
    """Lateral travel (metres) over frames a..b-1, keeping the lower (planted) foot still."""
    x = np.zeros(b - a); prev = None
    for k, i in enumerate(range(a, b)):
        side = LF if F[i, LF, 1].mean() <= F[i, RF, 1].mean() else RF
        foot = F[i, side, 0].mean()
        if k: x[k] = x[k - 1] + ((prev[1] - foot) if prev[0] == side[0] else 0)
        prev = (side[0], foot)
    return x

moves = []; i = 0
while i < n:
    if not quiet[i]:
        j = i
        while j < n and not quiet[j]: j += 1
        if j - i >= 10: moves.append((i, j))
        i = j
    else: i += 1

def mm(a, b):
    return np.rint(F[a:b] * 1000).astype(int).reshape(b - a, -1).tolist()

clips = []
for k, (a, b) in enumerate(moves):
    base = max(0, a - 5)
    drop = hipH[base] - hipH[a:b].min()
    if drop < 0.08: continue
    seg = slice(a, b)
    dz = F[a:b, :, 2].mean(1) - F[base, :, 2].mean()
    fwd = np.abs(F[a:b, LF + RF, 2] - F[base, LF + RF, 2]).max()
    pk = a + int(np.argmin(hipH[a:b]))
    side = 'right' if shift[pk] > 0 else 'left'
    # A step toward the attacker (forward jab) is not a lateral commit.
    if fwd > 0.35 and abs(yaw[pk]) < 30: continue
    turned = abs(yaw[pk]) >= 45
    c0 = max(0, a - 3); c1 = min(n, pk + 3)
    # Recover: through the next move when it follows straight on and is not another lunge.
    r1 = min(n, b + 4)
    if k + 1 < len(moves):
        a2, b2 = moves[k + 1]
        if a2 - b <= 20 and hipH[max(0, a2 - 5)] - hipH[a2:b2].min() < 0.08: r1 = min(n, b2 + 4)
    r1 = min(r1, c1 + 45)  # at most 1.5 s; the app blends back into guard after it
    if r1 - c1 < 12: continue
    tx = travel(c0, r1)
    # Travel that disagrees with the loaded side is depth noise from the single camera: skip the move.
    if np.sign(tx[c1 - c0 - 1]) != (1 if side == 'right' else -1) or abs(tx[c1 - c0 - 1]) < 0.05: continue
    # The commit must end clearly loaded on that side (hips over the stepping leg).
    e = c1 - 1
    w = hip[e, 0] - ank[e, 0]
    if np.sign(w) != (1 if side == 'right' else -1) or abs(w) < 0.04: continue
    # End the recovery where the move started, so the defender is centred for the next rep.
    rec = tx[c1 - c0:]
    tx[c1 - c0:] = rec - rec[-1] * np.linspace(0, 1, len(rec))
    clips.append({
        'id': f'take2-{a / 30:.2f}s',
        'side': side,
        'turned': bool(turned),
        'depthMm': int(round(drop * 1000)),
        'commit': {'frames': mm(c0, c1), 'rootXMm': np.rint(tx[: c1 - c0] * 1000).astype(int).tolist()},
        'recover': {'frames': mm(c1, r1), 'rootXMm': np.rint(tx[c1 - c0:] * 1000).astype(int).tolist()},
    })

# Guard loop: the calmest stretch of at least 1.2 s in a guard-height stance.
best = None
for a in range(0, n - 36):
    w = slice(a, a + 36)
    if not quiet[w].all(): continue
    s = stance[w].mean(); h = hipH[w].mean()
    if not (0.35 <= s <= 0.65): continue
    score = vs[w].mean() + abs(h - np.median(hipH)) * 0.05
    if best is None or score < best[0]: best = (score, a)
ga = best[1]
G = F[ga: ga + 36].copy()
# Close the loop: blend the last 8 frames toward the first so it repeats without a jump.
for k in range(8):
    w = (k + 1) / 9
    G[28 + k] = G[28 + k] * (1 - w) + G[0] * w
guard = {'id': f'take2-{ga / 30:.2f}s', 'frames': np.rint(G * 1000).astype(int).reshape(36, -1).tolist()}

json.dump({'format': 'defender-clips/1', 'source': 'assets/defender-motion/take2.json', 'fps': 30, 'joints': J,
           'axes': d['axes'], 'guard': guard, 'moves': clips}, open(out, 'w'), separators=(',', ':'))
print('guard from', ga / 30, 's;', len(clips), 'moves:', sum(c['side'] == 'left' for c in clips), 'left,', sum(c['side'] == 'right' for c in clips), 'right,', sum(c['turned'] for c in clips), 'turned')
for c in clips: print(' ', c['id'], c['side'], 'turned' if c['turned'] else '', c['depthMm'], 'commit', len(c['commit']['frames']), 'recover', len(c['recover']['frames']), 'travel', c['commit']['rootXMm'][-1])
