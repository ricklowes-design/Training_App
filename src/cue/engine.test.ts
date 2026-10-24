import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { initCue, parseDisplayS, planReps, tickCue, type CueConfig, type CueState } from './engine';

const p = loadProgramme();
const drill = (id: string) => p.cueDrills.find((c) => c.id === id)!;
const base = (id: string, over: Partial<CueConfig> = {}): CueConfig => ({
  drill: drill(id),
  displayS: [1.5, 1.5],
  reps: 16,
  useTripwire: false,
  catchFraction: 0,
  catchTypes: [],
  secondCueFraction: 0,
  seed: 42,
  ...over,
});

function runFor(s: CueState, fromMs: number, toMs: number, input: (t: number) => { tripwireMs?: number } = () => ({}), step = 10) {
  const actions: { t: number; type: string }[] = [];
  for (let t = fromMs; t <= toMs && !s.done; t += step) {
    const r = tickCue(s, t, input(t));
    s = r.state;
    r.actions.forEach((a) => actions.push({ t, type: a.type }));
  }
  return { s, actions };
}

describe('cue engine', () => {
  it('balances values across a block', () => {
    const reps = planReps(base('cue-defender'));
    const count = (v: string) => reps.filter((r) => r.value === v).length;
    expect(count('BIT') + count('HELD') + count('BLOCKED')).toBe(16);
    expect(Math.max(count('BIT'), count('HELD'), count('BLOCKED')) - Math.min(count('BIT'), count('HELD'), count('BLOCKED'))).toBeLessThanOrEqual(1);
  });

  it('places the configured share of catch trials, never in the first two reps', () => {
    const reps = planReps(base('cue-exit', { catchFraction: 0.25, catchTypes: ['noCue', 'blockedShaping', 'lateCue'] }));
    const c = reps.filter((r) => r.catchType);
    expect(c).toHaveLength(4);
    expect(c.every((r) => r.index >= 2)).toBe(true);
  });

  it('without a camera, each rep: start tone, then the cue inside the start-to-cue window', () => {
    const d = drill('cue-exit');
    const { s, actions } = runFor(initCue(base('cue-exit')), 0, 16 * d.repPeriodS! * 1000 + 100);
    expect(s.done).toBe(true);
    expect(s.log).toHaveLength(16);
    for (const e of s.log) {
      const delay = e.cueMs! - e.repStartMs;
      expect(delay).toBeGreaterThanOrEqual(d.startToCueMinS! * 1000);
      expect(delay).toBeLessThanOrEqual(d.startToCueMaxS! * 1000 + 10);
    }
    expect(actions.filter((a) => a.type === 'repTone')).toHaveLength(16);
    expect(actions.filter((a) => a.type === 'cueTone')).toHaveLength(16);
  });

  it('with the tripwire, the cue never fires before the crossing and the delay stays in 0–400 ms', () => {
    const d = drill('cue-exit');
    const period = d.repPeriodS! * 1000;
    // She crosses the tripwire 2.2 s into each rep.
    const input = (t: number) => {
      const repStart = Math.floor(t / period) * period;
      return t - repStart >= 2200 ? { tripwireMs: repStart + 2200 } : {};
    };
    const { s } = runFor(initCue(base('cue-exit', { useTripwire: true })), 0, 16 * period + 100, input);
    expect(s.log).toHaveLength(16);
    for (const e of s.log) {
      expect(e.tripwireMs).toBeDefined();
      expect(e.cueMs!).toBeGreaterThanOrEqual(e.tripwireMs!);
      expect(e.cueMs! - e.tripwireMs!).toBeLessThanOrEqual(410);
    }
  });

  it('anchors use a fixed tripwire delay', () => {
    const reps = planReps(base('cue-exit', { useTripwire: true, fixedTripwireDelayMs: 200 }));
    expect(new Set(reps.map((r) => r.delayMs))).toEqual(new Set([200]));
  });

  it('no tripwire crossing: the rep is logged as missed and no cue shows', () => {
    const { s, actions } = runFor(initCue(base('cue-exit', { useTripwire: true, reps: 2 })), 0, 21_000);
    expect(s.log.every((e) => e.missedTripwire && e.cueMs === undefined)).toBe(true);
    expect(actions.some((a) => a.type === 'cueTone')).toBe(false);
  });

  it('a no-cue catch trial shows nothing and logs no cue time', () => {
    const cfg = base('cue-exit', { catchFraction: 0.25, catchTypes: ['noCue'] });
    const { s } = runFor(initCue(cfg), 0, 16 * 10_000 + 100);
    const catches = s.log.filter((e) => e.catchType === 'noCue');
    expect(catches).toHaveLength(4);
    expect(catches.every((e) => e.cueMs === undefined)).toBe(true);
  });

  it('second cue follows HELD 300–600 ms later when enabled', () => {
    const { s } = runFor(initCue(base('cue-defender', { secondCueFraction: 1 })), 0, 16 * 10_000 + 100);
    const held = s.log.filter((e) => e.value === 'HELD');
    expect(held.length).toBeGreaterThan(0);
    for (const e of held) {
      expect(e.secondCueMs! - e.cueMs!).toBeGreaterThanOrEqual(300);
      expect(e.secondCueMs! - e.cueMs!).toBeLessThanOrEqual(610);
    }
  });

  it('interval cues change every 2–3 s', () => {
    const { s } = runFor(initCue(base('cue-colour', { reps: null })), 0, 30_000);
    const gaps = s.log.slice(1).map((e, i) => e.cueMs! - s.log[i].cueMs!);
    expect(gaps.every((g) => g >= 2000 && g <= 3010)).toBe(true);
  });

  it('reads cue display seconds from params and benchmark levels', () => {
    expect(parseDisplayS('cue 3 s slow', undefined, 1)).toEqual([3, 3]);
    expect(parseDisplayS('cue 1-1.5 s random', undefined, 1)).toEqual([1, 1.5]);
    expect(parseDisplayS('', '2', 1)).toEqual([2, 2]);
    expect(parseDisplayS('pace', 'std', 1.5)).toEqual([1.5, 1.5]);
  });
});
