import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { fullRun } from '../test/factories';
import type { BlockResult } from '../db/types';
import { activityCheckFor, evaluateCompletion, practiceMinutes } from './completion';
import { buildPlan, findSession, standardPlan, type RunBlock } from './plans';

const p = loadProgramme();
const plan = standardPlan(p, findSession(p, 'feinting', 7)!); // warmup, F2, rest, F7, FB, log
const benchIdx = plan.blocks.findIndex((b) => b.kind === 'benchmark');
const base = { plan: plan.blocks, pauses: [], sessionLengthS: 1200, stopped: false, benchmarksLogged: new Set([benchIdx]) };

describe('completion rule (plan/14 §14.6 items 1–3 and 5)', () => {
  it('all blocks to the end with the benchmark logged is completed', () => {
    expect(evaluateCompletion({ ...base, results: fullRun(plan) }).status).toBe('completed');
  });

  it('benchmark skipped is completedBenchmarkSkipped', () => {
    const r = evaluateCompletion({ ...base, results: fullRun(plan), benchmarksLogged: new Set() });
    expect(r.status).toBe('completedBenchmarkSkipped');
  });

  it('a skipped core block gives partial with the reason', () => {
    const results = fullRun(plan);
    results[3] = { ...results[3], skipped: true, ranToEnd: false, elapsedS: 0 };
    const r = evaluateCompletion({ ...base, results });
    expect(r).toEqual({ status: 'partial', reasons: ['block 4 skipped'] });
  });

  it('warm-up cut short gives partial', () => {
    const results = fullRun(plan);
    results[0] = { ...results[0], ranToEnd: false, elapsedS: 60 };
    expect(evaluateCompletion({ ...base, results }).status).toBe('partial');
  });

  it('a timed block ended early does not count, even past 80%', () => {
    const results = fullRun(plan);
    results[1] = { ...results[1], mode: 'timed', ranToEnd: false, doneEarly: true, elapsedS: 340 };
    expect(evaluateCompletion({ ...base, results }).status).toBe('partial');
  });

  it('a rep block with DONE after 80% of its cap counts; before 80% it does not', () => {
    const ok = fullRun(plan);
    ok[3] = { ...ok[3], mode: 'reps', ranToEnd: false, doneEarly: true, elapsedS: 0.8 * 360 };
    expect(evaluateCompletion({ ...base, results: ok }).status).toBe('completed');
    const early = fullRun(plan);
    early[3] = { ...early[3], mode: 'reps', ranToEnd: false, doneEarly: true, elapsedS: 0.79 * 360 };
    expect(evaluateCompletion({ ...base, results: early }).status).toBe('partial');
  });

  it('a Repeat attempt that ran fully makes the block count', () => {
    const results = fullRun(plan);
    results[1] = { ...results[1], ranToEnd: false, skipped: true, elapsedS: 10 };
    results.push({ ...results[1], attempt: 2, ranToEnd: true, skipped: false, elapsedS: 360 });
    expect(evaluateCompletion({ ...base, results }).status).toBe('completed');
  });

  it('a 6-minute pause in a 20-minute session gives partial', () => {
    const r = evaluateCompletion({ ...base, results: fullRun(plan), pauses: [{ startMs: 0, endMs: 6 * 60_000 }] });
    expect(r).toEqual({ status: 'partial', reasons: ['paused 6 minutes'] });
  });

  it('a single pause over 5 minutes gives partial even when the total is under 25%', () => {
    const r = evaluateCompletion({ ...base, sessionLengthS: 3600, results: fullRun(plan), pauses: [{ startMs: 0, endMs: 6 * 60_000 }] });
    expect(r).toEqual({ status: 'partial', reasons: ['one pause of 6 minutes'] });
  });

  it('pauses under both limits are allowed', () => {
    const pauses = [{ startMs: 0, endMs: 2 * 60_000 }, { startMs: 1e6, endMs: 1e6 + 2.9 * 60_000 }];
    expect(evaluateCompletion({ ...base, results: fullRun(plan), pauses }).status).toBe('completed');
  });

  it('total pauses of 25% or more give partial', () => {
    const pauses = [0, 1, 2, 3].map((i) => ({ startMs: i * 1e6, endMs: i * 1e6 + 4 * 60_000 }));
    const r = evaluateCompletion({ ...base, sessionLengthS: 3600, results: fullRun(plan), pauses });
    expect(r.status).toBe('partial');
    expect(r.reasons[0]).toBe('paused 16 minutes');
  });

  it('a pause over 30 minutes gives partial (plan/02 §2.11)', () => {
    expect(evaluateCompletion({ ...base, results: fullRun(plan), pauses: [{ startMs: 0, endMs: 31 * 60_000 }] }).status).toBe('partial');
  });

  it('with the camera on, a work block with an empty area is not credited (item 4), reported as a camera check (Brief R03)', () => {
    const results = fullRun(plan);
    results[1] = { ...results[1], presenceFrac: 0.5 };
    expect(evaluateCompletion({ ...base, results })).toEqual({ status: 'partial', reasons: ['block 2: camera activity check could not confirm it'] });
    results[1] = { ...results[1], presenceFrac: 0.7 };
    expect(evaluateCompletion({ ...base, results }).status).toBe('completed');
  });

  it('STOP gives stopped', () => {
    expect(evaluateCompletion({ ...base, results: fullRun(plan), stopped: true }).status).toBe('stopped');
  });

  it('a light session (no benchmark) is completed', () => {
    const r = buildPlan(p, { minutes: 20, sessions: [findSession(p, 'feinting', 7)!], light: true, partner: false });
    if (!r.ok) throw new Error(r.reason);
    const out = evaluateCompletion({ plan: r.plan.blocks, results: fullRun(r.plan), pauses: [], sessionLengthS: 1200, stopped: false, benchmarksLogged: new Set() });
    expect(out.status).toBe('completed');
  });

  it('multi-area runs are judged per area', () => {
    const r = buildPlan(p, { minutes: 45, sessions: [findSession(p, 'scanning', 5)!, findSession(p, 'control', 6)!], light: false, partner: false });
    if (!r.ok) throw new Error(r.reason);
    const results = fullRun(r.plan);
    const secondAreaWork = r.plan.blocks.findIndex((b) => b.kind === 'work' && b.partIndex === 1);
    results[secondAreaWork] = { ...results[secondAreaWork], skipped: true, ranToEnd: false };
    const logged = new Set(r.plan.blocks.map((b, i) => (b.kind === 'benchmark' ? i : -1)).filter((i) => i >= 0));
    const common = { plan: r.plan.blocks, results, pauses: [], sessionLengthS: 2700, stopped: false, benchmarksLogged: logged };
    expect(evaluateCompletion({ ...common, partIndex: 0 }).status).toBe('completed');
    expect(evaluateCompletion({ ...common, partIndex: 1 }).status).toBe('partial');
  });
});

describe('camera activity check (Brief R03)', () => {
  const plan: RunBlock[] = [{ kind: 'work', minutes: 4, mode: 'timed', drillId: 'D1' }];
  const ran = (presenceFrac?: number): BlockResult => ({ index: 0, kind: 'work', attempt: 1, plannedS: 240, elapsedS: 240, ranToEnd: true, doneEarly: false, skipped: false, mode: 'timed', presenceFrac });
  const judge = (results: BlockResult[]) => evaluateCompletion({ plan, results, pauses: [], sessionLengthS: 240, stopped: false, benchmarksLogged: new Set() });

  it('a block that ran its time but the camera could not confirm gets a technical reason, not "skipped"', () => {
    const r = judge([ran(0.2)]);
    expect(r.status).toBe('partial'); // the credit rule is unchanged until the owner decides
    expect(r.reasons).toEqual(['block 1: camera activity check could not confirm it']);
  });
  it('a skipped block is still a skipped block', () => {
    expect(judge([{ ...ran(), ranToEnd: false, elapsedS: 0, skipped: true }]).reasons).toEqual(['block 1 skipped']);
  });
  it('the check is stored apart from the decision; no camera data is "unavailable", never zero', () => {
    expect(activityCheckFor(undefined, false)).toBe('unavailable');
    expect(activityCheckFor(0.9, false)).toBe('confirmed');
    expect(activityCheckFor(0.3, false)).toBe('notConfirmed');
    expect(activityCheckFor(0.9, true)).toBe('cameraMoved');
  });
  it('practice minutes count every block that ran, whatever the outcome', () => {
    expect(practiceMinutes([ran(0.2), { ...ran(), skipped: true }])).toBe(4);
  });
});
