import { describe, expect, it } from 'vitest';
import { validateProgramme } from '../content/validate';
import type { BlockResult, DefenderScenario } from '../db/types';
import { loadProgramme } from '../test/fixtures';
import { coneMoves, evaluateCheck, footageReasons, footageStats, systemTestPlan, type BlockEvidence } from './systemTest';

const p = loadProgramme();

const W = 32;
const H = 18;
const flat = (v: number) => new Uint8Array(W * H).fill(v);
/** A sharp checkerboard, shifted by `off` columns (movement between frames). */
const checker = (lo: number, hi: number, off = 0) => {
  const f = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = ((x + off + y) & 1) ? hi : lo;
  return f;
};

const block = (over: Partial<BlockResult> = {}): BlockResult => ({ index: 0, kind: 'work', attempt: 1, plannedS: 180, elapsedS: 180, ranToEnd: true, doneEarly: false, skipped: false, mode: 'reps', ...over });
const ev = (over: Partial<BlockEvidence> = {}, ctx: Partial<BlockEvidence['ctx']> = {}): BlockEvidence => ({
  block: block(),
  hasClip: true,
  analysisExpected: true,
  reps: [],
  scenarios: [],
  ...over,
  ctx: { cameraOn: true, setup: true, setupTripwire: true, setupGates: true, setupSquare: true, pose: 'lite', analysisFps: 15, flags: { defender3d: true, liveOnsetDetector: true, ballTracking: true }, ballProfile: true, wallUsable: true, wallMic: true, ...ctx },
});
const scen = (src: DefenderScenario['triggerSource'], feint?: 'left' | 'right') => ({ triggerSource: src, feintDirection: feint }) as DefenderScenario;

describe('system test plan', () => {
  it('runs every content block, never counts, and moves the cones once per layout change', () => {
    const plan = systemTestPlan(p)!;
    expect(plan.parts).toEqual([{ kind: 'systemTest' }]);
    expect(plan.blocks.map((b) => b.drillId)).toEqual(p.systemTest!.blocks.map((b) => b.drillId));
    expect(plan.blocks.every((b) => b.kind === 'work')).toBe(true);
    const layouts = p.systemTest!.blocks.map((b) => b.layoutId);
    expect(coneMoves(p)).toBe(new Set(layouts).size - 1);
  });

  it('covers every feature check at least once', () => {
    const used = new Set(p.systemTest!.blocks.flatMap((b) => b.checks));
    for (const c of ['recording', 'presence', 'cueEngine', 'tripwire', 'wallBang', 'looks', 'decision', 'defender3d', 'feintDetector', 'ballTracking', 'gateEvents', 'vPulls', 'rapidTouches', 'slalom']) expect(used.has(c)).toBe(true);
  });

  it('content validation rejects an unknown check and a layout that comes back', () => {
    expect(validateProgramme(p).ok).toBe(true);
    const bad = structuredClone(p);
    bad.systemTest!.blocks[0].checks.push('telepathy');
    bad.systemTest!.blocks.push({ ...bad.systemTest!.blocks[0] });
    const r = validateProgramme(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('unknown check "telepathy"'))).toBe(true);
      expect(r.errors.some((e) => e.includes('comes back after another layout'))).toBe(true);
    }
  });
});

describe('footage statistics', () => {
  it('a dark, flat, still picture: dark, blurred and nobody moving', () => {
    const f = footageStats([flat(20), flat(20), flat(20)], W, H);
    expect(f.meanLuma).toBe(20);
    expect(f.sharpness).toBe(0);
    expect(f.motion).toBe(0);
    const r = footageReasons(f);
    expect(r[0]).toMatch(/^The picture is dark/);
    expect(r.some((x) => x.includes('blurred'))).toBe(true);
    expect(r.some((x) => x.includes('out of view'))).toBe(true);
  });

  it('a sharp, well-lit picture with movement: no reasons', () => {
    const f = footageStats([checker(90, 170), checker(90, 170, 1), checker(90, 170)], W, H);
    expect(f.meanLuma).toBe(130);
    expect(f.sharpness).toBeGreaterThan(1000);
    expect(f.motion).toBeGreaterThan(10);
    expect(footageReasons(f)).toEqual([]);
  });

  it('a window behind the player: washed out', () => {
    const f = footageStats([checker(100, 255), checker(100, 255, 1)], W, H);
    expect(footageReasons(f).some((x) => x.includes('washed out'))).toBe(true);
  });
});

describe('feature checks', () => {
  it('recording off in the app is the reason no clip was saved', () => {
    const o = evaluateCheck('recording', ev({ hasClip: false }, { cameraOn: false }));
    expect(o.result).toBe('fail');
    expect(o.reasons[0]).toMatch(/Recording is off in the app/);
  });

  it('a skipped block is "not run", not a failure', () => {
    expect(evaluateCheck('decision', ev({ block: block({ skipped: true }) })).result).toBe('notRun');
  });

  it('camera analysis still running shows as pending', () => {
    expect(evaluateCheck('looks', ev({ analysis: undefined })).result).toBe('pending');
  });

  it('feint detector: share of reps the camera triggered, with reasons from the footage', () => {
    const dark = footageStats([flat(30), flat(30)], W, H);
    const o = evaluateCheck('feintDetector', ev({ footage: dark, scenarios: [scen('cameraOnset', 'left'), scen('plannedTiming'), scen('plannedTiming'), scen('plannedTiming')] }));
    expect(o.result).toBe('fail');
    expect(o.detail).toBe('The camera triggered the defender on 1 of 4 reps (fake direction seen on 1); the rest used planned timing.');
    expect(o.reasons.some((r) => r.startsWith('The picture is dark'))).toBe(true);
    const off = evaluateCheck('feintDetector', ev({ scenarios: [scen('plannedTiming')] }, { flags: { liveOnsetDetector: false } }));
    expect(off.reasons[0]).toMatch(/live feint detector is switched off/);
    expect(evaluateCheck('feintDetector', ev({ scenarios: [scen('cameraOnset'), scen('cameraOnset')] })).result).toBe('pass');
  });

  it('wall bang: heard share, and why it never listened', () => {
    const log = [0, 1, 2, 3].map((i) => ({ rep: i, repStartMs: 0, trigger: 'sound' as const, cueMs: 100, plannedDelayMs: 0, noBang: i > 0 }));
    expect(evaluateCheck('wallBang', ev({ block: block({ cueLog: log }) })).result).toBe('fail');
    expect(evaluateCheck('wallBang', ev({ block: block({ cueLog: log.map((x) => ({ ...x, noBang: false })) }) })).result).toBe('pass');
    const never = evaluateCheck('wallBang', ev({ block: block({ cueLog: [] }) }, { wallUsable: false }));
    expect(never.reasons[0]).toMatch(/back wall cannot be used/);
  });

  it('tripwire: no line drawn is the first reason', () => {
    const log = [{ rep: 0, repStartMs: 0, trigger: 'timed' as const, cueMs: 100, plannedDelayMs: 0 }];
    const o = evaluateCheck('tripwire', ev({ block: block({ cueLog: log }) }, { setupTripwire: false }));
    expect(o.result).toBe('fail');
    expect(o.reasons[0]).toMatch(/No tripwire/);
  });

  it('decision read: most common analysis flags are given with a hint', () => {
    const reps = [0, 1, 2, 3].map((i) => ({ repIndex: i, zoneEvents: [], confidence: 0.5, flags: i < 3 ? ['body lost'] : [], status: i < 3 ? ('unableToAssess' as const) : ('ok' as const), decisionCorrect: i < 3 ? undefined : true }));
    const o = evaluateCheck('decision', ev({ reps, analysis: { reps: 4, validReps: 1, accuracyByCue: {}, flaggedRepIndexes: [], enoughReps: false, poseUsed: true, analysedFps: 15, analysisMs: 1 } }));
    expect(o.result).toBe('fail');
    expect(o.reasons[0]).toBe('3 of 4 reps: "body lost" (the camera lost the body: too far, cut off at the edge, or too dark).');
  });

  it('a passing check has no reasons', () => {
    expect(evaluateCheck('recording', ev()).reasons).toEqual([]);
  });
});
