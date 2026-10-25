import { describe, expect, it } from 'vitest';
import file from './mocap/clips.json';
import { buildLibrary, J, JOINTS, mirrorFrame, mocapPose, pickMove, proceduralJoints, type ClipFile } from './mocap';
import { plannedTriggerMs, poseAt, repEndMs, type DefenderMotion } from './stateMachine';

const lib = buildLibrary(file as ClipFile);
const m = (over: Partial<DefenderMotion>): DefenderMotion => ({ approachMs: 1800, approachAngleDeg: 10, initialSide: 'centre', reaction: 'commit', commitDirection: 'left', strength: 0.7, reactionDelayMs: 250, recovery: false, ...over });
const at = (x: DefenderMotion, t: number) => {
  const trig = plannedTriggerMs(x);
  return mocapPose(lib, x, t, trig, poseAt(x, t, trig));
};
const pt = (f: Float32Array, j: number) => ({ x: f[j * 3], y: f[j * 3 + 1], z: f[j * 3 + 2] });
/** Weight side: hips relative to the middle of the feet; < 0 = over the player's-left leg. */
const weight = (f: Float32Array) => (pt(f, J.leftHip).x + pt(f, J.rightHip).x) / 2 - (pt(f, J.leftAnkle).x + pt(f, J.rightAnkle).x) / 2;

describe('recorded-motion defender', () => {
  it('has the same moves to both sides (every move mirrored)', () => {
    const left = lib.moves.filter((x) => x.side === 'left');
    const right = lib.moves.filter((x) => x.side === 'right');
    expect(left.length).toBeGreaterThanOrEqual(10);
    expect(left.length).toBe(right.length);
    expect(lib.guard.length).toBeGreaterThan(20);
    expect(JOINTS).toHaveLength(19);
  });

  it('mirroring twice gives the original frame', () => {
    const f = lib.moves[0].commit.frames[5];
    const back = mirrorFrame(mirrorFrame(f));
    for (let i = 0; i < f.length; i++) expect(back[i]).toBeCloseTo(f[i], 6);
  });

  it('every move ends its commit loaded toward its side, and travels that way (no mirrored defender)', () => {
    for (const mv of lib.moves) {
      const end = mv.commit.frames[mv.commit.frames.length - 1];
      const sign = mv.side === 'left' ? -1 : 1;
      expect(Math.sign(weight(end))).toBe(sign);
      expect(Math.sign(mv.commit.rootX[mv.commit.rootX.length - 1])).toBe(sign);
    }
  });

  for (const side of ['left', 'right'] as const) {
    it(`commit ${side}: the defender moves and loads to the player's ${side}`, () => {
      const x = m({ commitDirection: side });
      const p = at(x, repEndMs(x, plannedTriggerMs(x)) - 10);
      const sign = side === 'left' ? -1 : 1;
      expect(p.state).toBe('commit');
      expect(Math.sign(p.x)).toBe(sign);
      expect(Math.abs(p.x)).toBeGreaterThan(0.05);
      expect(Math.sign(weight(p.joints!))).toBe(sign);
    });
  }

  it('keeps the state machine timing and state at every moment', () => {
    for (const reaction of ['commit', 'hold', 'delay', 'commitOpposite', 'commitThenRecover'] as const) {
      const x = m({ reaction, recovery: reaction === 'commitThenRecover' });
      const trig = plannedTriggerMs(x);
      for (let t = 0; t < repEndMs(x, trig); t += 50) expect(at(x, t).state).toBe(poseAt(x, t, trig).state);
    }
  });

  it('moves smoothly: no joint jumps more than 6 cm in 10 ms, through every reaction', () => {
    for (const reaction of ['commit', 'hold', 'delay', 'commitThenRecover'] as const)
      for (const side of ['left', 'right'] as const)
        for (const strength of [0.5, 0.9]) {
          const x = m({ reaction, commitDirection: side, strength, recovery: reaction === 'commitThenRecover' });
          let prev = at(x, 0);
          for (let t = 10; t < plannedTriggerMs(x) + 5000; t += 10) {
            const p = at(x, t);
            let worst = 0;
            for (let j = 0; j < 19; j++) {
              const a = pt(prev.joints!, j);
              const b = pt(p.joints!, j);
              worst = Math.max(worst, Math.hypot(a.x + prev.x - b.x - p.x, a.y - b.y, a.z - b.z));
            }
            expect(worst, `${reaction} ${side} ${strength} at ${t} ms`).toBeLessThan(0.06);
            prev = p;
          }
        }
  });

  it('recovers back to the middle before the next rep (reps are at least 8 s apart)', () => {
    for (const side of ['left', 'right'] as const)
      for (const strength of [0.45, 0.6, 0.75, 0.9]) {
        const x = m({ reaction: 'commitThenRecover', recovery: true, commitDirection: side, strength });
        expect(Math.abs(at(x, plannedTriggerMs(x) + x.reactionDelayMs + 3500).x)).toBeLessThan(0.02);
      }
  });

  it('the same rep always uses the same recorded move (replays match)', () => {
    const x = m({ strength: 0.63, reactionDelayMs: 310 });
    expect(pickMove(lib, x).id).toBe(pickMove(lib, { ...x }).id);
    const t = plannedTriggerMs(x) + 700;
    expect(Array.from(at(x, t).joints!)).toEqual(Array.from(at(x, t).joints!));
  });

  it('the approach run as joints: feet on the floor, head above the hips', () => {
    const p = poseAt(m({}), 600, null);
    const f = proceduralJoints(p);
    expect(Math.min(pt(f, J.leftHeel).y, pt(f, J.rightHeel).y)).toBeLessThan(0.05);
    expect(pt(f, J.nose).y).toBeGreaterThan(pt(f, J.leftHip).y + 0.4);
    // The defender's left foot is on the player's right.
    expect(pt(f, J.leftAnkle).x).toBeGreaterThan(pt(f, J.rightAnkle).x);
  });
});
