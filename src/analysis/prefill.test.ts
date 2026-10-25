import { describe, expect, it } from 'vitest';
import { cameraPrefill } from './prefill';
import type { BlockAnalysis, RepAnalysis } from './types';

const block = { reps: 10, validReps: 10, accuracyByCue: {}, flaggedRepIndexes: [], enoughReps: true, poseUsed: false, analysedFps: 15, analysisMs: 100 } as BlockAnalysis;
const rep = (i: number, over: Partial<RepAnalysis> = {}): RepAnalysis => ({ repIndex: i, zoneEvents: [], confidence: 0.9, flags: [], status: 'ok', decisionCorrect: i % 3 !== 0, ...over });

describe('camera estimates for anchor cards (D10)', () => {
  it('fills the decision count when every rep was judged', () => {
    const reps = Array.from({ length: 10 }, (_, i) => rep(i));
    expect(cameraPrefill('SB', block, reps)).toEqual({ values: { correct: 6 }, judged: 10, of: 10 });
  });
  it('fills nothing when the camera missed a rep, and says how many it judged', () => {
    const reps = Array.from({ length: 10 }, (_, i) => rep(i, i === 4 ? { status: 'unableToAssess', decisionCorrect: undefined } : {}));
    expect(cameraPrefill('SB', block, reps)).toEqual({ judged: 9, of: 10 });
  });
  it('A3 also counts possible early starts; A4 counts reps with a look before the touch', () => {
    const a3 = Array.from({ length: 16 }, (_, i) => rep(i, { preCueMovement: i < 2 }));
    expect(cameraPrefill('A3', { ...block, reps: 16 }, a3)?.values).toEqual({ correct: 10, early: 2 });
    const a4 = Array.from({ length: 10 }, (_, i) => rep(i, { looksBeforeTouch: i < 7 ? 1 : 0 }));
    expect(cameraPrefill('A4', block, a4)?.values).toEqual({ correct: 6, looks: 7 });
  });
  it('no analysis yet: nothing', () => {
    expect(cameraPrefill('A4', undefined, [])).toBeNull();
  });
});
