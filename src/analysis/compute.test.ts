import { describe, expect, it } from 'vitest';
import type { CueLogEntry } from '../cue/engine';
import { analyseBlock, analyseReps, decision, exitFromHips, herSide, looks, maxHeadTurn, reactionOnset, slope, zoneEvents, type FrameData, type Pose } from './compute';

const P = (x: number, y: number, v = 1) => ({ x, y, v });
/** A standing figure centred at cx, facing the camera, head turned by `turn` shoulder widths. */
function pose(cx: number, hipW = 0.06, turn = 0, headDown = false): Pose {
  return {
    nose: P(cx + turn * 0.08, headDown ? 0.37 : 0.3),
    lEye: P(cx + 0.01, 0.29),
    rEye: P(cx - 0.01, 0.29),
    lShoulder: P(cx + 0.04, 0.4),
    rShoulder: P(cx - 0.04, 0.4),
    lHip: P(cx + hipW / 2, 0.6),
    rHip: P(cx - hipW / 2, 0.6),
    lAnkle: P(cx + 0.02, 0.9),
    rAnkle: P(cx - 0.02, 0.9),
  };
}
const frames = (fromMs: number, toMs: number, fps: number, f: (t: number) => Partial<FrameData>): FrameData[] => {
  const out: FrameData[] = [];
  for (let t = fromMs; t < toMs; t += 1000 / fps) out.push({ tMs: t, area: 0.01, zones: {}, ...f(t) });
  return out;
};

describe('analysis building blocks', () => {
  it("the player's side: picture right is the player's left unless mirrored", () => {
    expect(herSide(0.1, false)).toBe('left');
    expect(herSide(0.1, true)).toBe('right');
  });

  it('zone events: a ball entering a gate for two frames', () => {
    const f = frames(0, 2000, 30, (t) => ({ zones: { 'her-left gate': t >= 1000 && t < 1300 ? 0.3 : 0 } }));
    expect(zoneEvents(f, ['her-left gate'])).toEqual([{ zone: 'her-left gate', tMs: expect.closeTo(1000, 0) }]);
  });

  it('reaction onset within one frame of the first movement', () => {
    const f = frames(0, 3000, 30, (t) => ({ area: t >= 1430 ? 0.2 : 0.005 }));
    const r = reactionOnset(f, 1200);
    expect(Math.abs(r.onsetMs! - 1430)).toBeLessThan(34);
  });

  it('reaction onset is not timed when the player was already moving', () => {
    const f = frames(0, 3000, 30, () => ({ area: 0.2 }));
    expect(reactionOnset(f, 1200).reason).toBe('moving before the cue');
  });

  it('exit: feint one way, exit the other; exit time at the hip reversal', () => {
    // Cue at 1000 ms; hips drift to picture-left until 1300 ms (the feint), then go right.
    const x = (t: number) => (t < 1000 ? 0.5 : t < 1300 ? 0.5 - (0.02 * (t - 1000)) / 300 : 0.48 + (0.1 * (t - 1300)) / 600);
    const f = frames(0, 2600, 30, (t) => ({ pose: pose(Math.min(x(t), 0.58)) }));
    const e = exitFromHips(f, 1000, false);
    expect(e.exitDir).toBe('left'); // picture right = the player's left
    expect(Math.abs(e.exitMs! - 1300)).toBeLessThan(40);
  });

  it('looks: two head turns held over 100 ms before the touch', () => {
    const turned = (t: number) => (t > 500 && t < 700) || (t > 1200 && t < 1450);
    const f = frames(0, 2000, 30, (t) => ({ pose: pose(0.5, 0.06, turned(t) ? 0.5 : 0) }));
    const l = looks(f, 0, 1800);
    expect(l.count).toBe(2);
    expect(l.lastEndMs).toBeGreaterThan(1440);
  });

  it('a personalised look threshold counts a smaller held head turn; the largest held turn is measured', () => {
    // A turn of 0.3 shoulder widths held for 250 ms: below the base 0.35, above a learned 0.25.
    const f = frames(0, 2000, 30, (t) => ({ pose: pose(0.5, 0.06, t > 800 && t < 1050 ? 0.3 : 0) }));
    expect(looks(f, 0, 1800).count).toBe(0);
    expect(looks(f, 0, 1800, 0.25).count).toBe(1);
    expect(maxHeadTurn(f, 0, 1800)).toBeCloseTo(0.3, 2);
  });

  it('decisions from gates', () => {
    expect(decision('LEFT', undefined, undefined, 'left')).toBe(true);
    expect(decision('RIGHT FREE', undefined, undefined, 'left')).toBe(false);
    expect(decision('BOTH BLOCKED', undefined, undefined, 'back')).toBe(true);
    expect(decision('BLOCKED', 'blockedShaping', 'left', 'left')).toBe(false); // ran into the defender
    expect(decision('BIT', undefined, undefined, 'left')).toBeUndefined(); // judged by a person
    expect(decision('LEFT', 'noCue', undefined, 'left')).toBeUndefined();
  });

  it('slope with standard error', () => {
    const s = slope([1, 2, 3, 4], [2.1, 3.9, 6.2, 7.8])!;
    expect(s.slope).toBeCloseTo(1.92, 1);
    expect(s.se).toBeGreaterThan(0);
  });
});

describe('rep and block analysis', () => {
  // 10 reps, 3 s each; cue at +1 s; the player exits through the cued gate 450 ms after the cue.
  const log: CueLogEntry[] = Array.from({ length: 10 }, (_, i) => ({
    rep: i,
    repStartMs: i * 3000,
    trigger: 'timed' as const,
    cueMs: i * 3000 + 1000 + (i % 3) * 100,
    value: i % 2 ? 'LEFT' : 'RIGHT',
    plannedDelayMs: 1000,
  }));
  const fr = frames(0, 30_000, 30, (t) => {
    const rep = log[Math.floor(t / 3000)];
    const into = t - rep.cueMs!;
    const gate = rep.value === 'LEFT' ? 'her-left gate' : 'her-right gate';
    const zones: Record<string, number> = { 'her-left gate': 0, 'her-right gate': 0 };
    if (into >= 450 && into < 700) zones[gate] = 0.4;
    return { area: into >= 200 && into < 1200 ? 0.2 : 0.004, zones };
  });
  const reps = analyseReps(fr, log, { kind: 'scan', mirror: false, blockEndMs: 30_000, fps: 30 }, ['her-left gate', 'her-right gate']);

  it('scores every rep from the gates without pose', () => {
    expect(reps).toHaveLength(10);
    expect(reps.every((r) => r.status === 'ok')).toBe(true);
    expect(reps.every((r) => r.decisionCorrect === true)).toBe(true);
    expect(reps.every((r) => r.onsetMs !== undefined && Math.abs(r.onsetMs - r.cueTimeMs! - 200) < 34)).toBe(true);
  });

  it('block scorecard: accuracy by cue type, enough reps, nothing flagged', () => {
    const b = analyseBlock(reps, { poseUsed: false, analysedFps: 30, analysisMs: 1 });
    expect(b.accuracy).toBe(1);
    expect(b.accuracyByCue.LEFT).toEqual({ correct: 5, of: 5 });
    expect(b.enoughReps).toBe(true);
    expect(b.flaggedRepIndexes).toEqual([]);
  });

  it('reps with too few frames are unable to assess and left out of the statistics', () => {
    const sparse = fr.filter((f) => f.tMs < 3000 || f.tMs >= 6000 || f.tMs % 200 < 34);
    const r = analyseReps(sparse, log, { kind: 'scan', mirror: false, blockEndMs: 30_000, fps: 30 }, ['her-left gate', 'her-right gate']);
    expect(r[1].status).toBe('unableToAssess');
    const b = analyseBlock(r, { poseUsed: false, analysedFps: 30, analysisMs: 1 });
    expect(b.validReps).toBe(9);
    expect(b.flaggedRepIndexes[0]).toBe(1);
    expect(b.flaggedRepIndexes.length).toBeLessThanOrEqual(3);
  });

  it('reactivity slope near 1 when exits track the cue; no 200 ms pre-commit rule any more (D6)', () => {
    const rs = log.map((e, i) => ({ repIndex: i, cueTimeMs: e.cueMs! - e.repStartMs, exitMs: e.cueMs! - e.repStartMs + (i < 2 ? 100 : 400), zoneEvents: [], confidence: 1, flags: [], status: 'ok' as const }));
    const b = analyseBlock(rs, { poseUsed: true, analysedFps: 30, analysisMs: 1 });
    expect(b.preCommitRate).toBeUndefined();
    expect(b.reactivitySlope!).toBeGreaterThan(0.5);
    // Exploratory and excluded below the sample size.
    expect(analyseBlock(rs.slice(0, 5), { poseUsed: true, analysedFps: 30, analysisMs: 1 }).reactivitySlope).toBeUndefined();
  });

  it('defender reps: correct by defender action, change of mind, early commitment only with evidence', () => {
    const rep = (i: number, reaction: string, correct: boolean | undefined, exitMs: number, early?: string) => ({
      repIndex: i, cueTimeMs: 1000, exitMs, defenderReaction: reaction, decisionCorrect: correct, possibleEarlyRouteCommitment: early, techniqueStatus: 'observedExecution' as const,
      fakeShiftHipWidths: 0.3, exitShiftHipWidths: 1, timingUncertaintyMs: 66, zoneEvents: [], confidence: 1, flags: [], status: 'ok' as const,
    });
    const reps = [rep(0, 'commit', true, 1400), rep(1, 'commit', false, 1300), rep(2, 'commitThenRecover', true, 1500), rep(3, 'commitThenRecover', false, 1350), rep(4, 'hold', undefined, 1600), rep(5, 'commit', false, 800, 'final exit movement began 200 ms before the defender moved (±66 ms)')];
    const b = analyseBlock(reps, { poseUsed: true, analysedFps: 15, analysisMs: 1 });
    expect(b.correctByDefenderAction).toEqual({ commit: { correct: 1, of: 3 }, commitThenRecover: { correct: 1, of: 2 } });
    expect(b.changeOfMind).toEqual({ correct: 1, of: 2 });
    expect(b.possibleEarlyRouteCommitments).toBe(1);
    expect(b.medianDeceptionRatio).toBeCloseTo(0.3);
    expect(b.flaggedRepIndexes[0]).toBe(5);
  });
});

describe('cue paint time (audit 2026-10-29, task 16)', () => {
  it('reactions are timed from when the cue was painted, when that is known', () => {
    const log: CueLogEntry[] = [{ rep: 0, repStartMs: 0, trigger: 'timed', cueMs: 1000, shownMs: 1060, value: 'LEFT', plannedDelayMs: 1000 }];
    // Movement starts 300 ms after the paint (360 ms after the schedule).
    const fr = frames(0, 3000, 30, (t) => ({ area: t >= 1360 ? 0.2 : 0.004, zones: { 'her-left gate': t >= 1600 && t < 1800 ? 0.4 : 0, 'her-right gate': 0 } }));
    const [r] = analyseReps(fr, log, { kind: 'scan', mirror: false, blockEndMs: 3000, fps: 30 }, ['her-left gate', 'her-right gate']);
    expect(r.cueTimeMs).toBe(1060);
    expect(r.onsetMs! - r.cueTimeMs!).toBeLessThan(340);
  });
});
