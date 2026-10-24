import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { evaluateCompletion } from '../domain/completion';
import { findSession, standardPlan } from '../domain/plans';
import { done, initRun, next, pause, repeat, resume, skip, startBlock, stop, tick, type Labels, type RunEvent, type RunState } from './engine';

const p = loadProgramme();
const plan = standardPlan(p, findSession(p, 'feinting', 7)!);
const labels: Labels = { blockName: (b) => b.drillId ?? b.benchmarkId ?? b.kind, warmupSteps: p.warmup.steps, countdownS: 10 };

/** Runs the clock forward in 250 ms steps, doing what the screen does on its own:
 *  demo auto-start and card auto-advance. Returns the final state and all events. */
function run(s: RunState, t: number, untilMs: number, opts: { onCard?: (s: RunState, t: number) => RunState } = {}) {
  const events: RunEvent[] = [];
  while (t < untilMs && s.phase !== 'done') {
    t += 250;
    if (s.phase === 'demo' && t - s.phaseStartMs >= 20_000) s = startBlock(s, t);
    else if (s.phase === 'card' && t - s.phaseStartMs >= 20_000) s = opts.onCard ? opts.onCard(s, t) : next(s, t);
    const r = tick(s, t, labels);
    s = r.state;
    events.push(...r.events);
  }
  return { s, t, events };
}

const completion = (s: RunState, benchmarksLogged = new Set<number>([4])) =>
  evaluateCompletion({ plan: s.plan.blocks, results: s.results, pauses: s.pauses, sessionLengthS: 1200, stopped: s.stopped, benchmarksLogged });

describe('session runner', () => {
  it('a 20-minute session runs to the end with no taps inside a block', () => {
    const { s, events } = run(initRun(plan, 0), 0, 60 * 60_000);
    expect(s.phase).toBe('done');
    expect(s.results.map((r) => r.ranToEnd)).toEqual([true, true, true, true, true, true]);
    expect(completion(s).status).toBe('completed');
    const said = events.filter((e) => e.type === 'say').map((e) => (e as { text: string }).text);
    expect(said).toContain('Thirty seconds.');
    expect(said).toContain('Half way.');
    expect(said.some((t) => t.startsWith('rest. Next: F7'))).toBe(true);
    expect(said).toContain(p.warmup.steps[0]);
  });

  it('pause stops the block clock and is recorded', () => {
    let s = initRun(plan, 0);
    ({ s } = run(s, 0, 30_000)); // into the warm-up
    const before = s.phase;
    s = pause(s, 30_000);
    let r = tick(s, 400_000, labels);
    expect(r.state.phase).toBe(before);
    s = resume(r.state, 6 * 60_000 + 30_000);
    expect(s.pauses).toEqual([{ startMs: 30_000, endMs: 6 * 60_000 + 30_000 }]);
    const out = run(s, 6 * 60_000 + 30_000, 3 * 60 * 60_000);
    expect(completion(out.s).status).toBe('partial');
  });

  it('a skipped core block gives partial', () => {
    let s = initRun(plan, 0);
    ({ s } = run(s, 0, 200_000)); // past the warm-up, at block 2 demo
    expect(s.phase).toBe('demo');
    s = skip(s, 200_000).state;
    const out = run(s, 200_000, 3 * 60 * 60_000);
    expect(out.s.results.find((r) => r.index === 1)?.skipped).toBe(true);
    expect(completion(out.s).status).toBe('partial');
  });

  it('DONE on a rep block after 80% counts', () => {
    let s = initRun(plan, 0);
    let t = 0;
    ({ s, t } = run(s, 0, 200_000));
    expect(s.phase).toBe("demo");
    s = startBlock(s, t);
    ({ s, t } = run(s, t, t + 10_000 + 0.85 * 360_000));
    expect(s.phase).toBe('active');
    s = done(s, t).state;
    expect(s.phase).toBe('card');
    const out = run(s, t, 3 * 60 * 60_000);
    expect(completion(out.s).status).toBe('completed');
  });

  it('Repeat stores attempt 2 separately', () => {
    let repeated = false;
    const out = run(initRun(plan, 0), 0, 3 * 60 * 60_000, {
      onCard: (s, t) => {
        if (!repeated && s.blockIdx === 1) {
          repeated = true;
          return repeat(s, t);
        }
        return next(s, t);
      },
    });
    const block2 = out.s.results.filter((r) => r.index === 1);
    expect(block2.map((r) => r.attempt)).toEqual([1, 2]);
  });

  it('STOP ends the session as stopped', () => {
    let s = initRun(plan, 0);
    ({ s } = run(s, 0, 60_000));
    s = stop(s, 60_000);
    expect(s.phase).toBe('done');
    expect(completion(s).status).toBe('stopped');
  });
});
