import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { initDefenderBlock, tickDefenderBlock, TRIGGER_TIMEOUT_MS, type DefenderBlockConfig } from './block';
import { plannedTriggerMs } from './stateMachine';

const p = loadProgramme();
const drill = p.defenderDrills.find((d) => d.id === 'def-read')!;
const cfg = (over: Partial<DefenderBlockConfig> = {}): DefenderBlockConfig => ({ drill, reps: 16, archetype: 'reactive', difficulty: 2, trigger: 'plannedTiming', view: 'player3d', seed: 42, rendererVersion: 'test', ...over });

function run(c: DefenderBlockConfig, taps: (rep: number, repStart: number) => number | undefined = () => undefined) {
  let s = initDefenderBlock(c);
  let tones = 0;
  for (let t = 0; t <= 16 * drill.repPeriodS * 1000 + 100; t += 20) {
    const tap = s.repStartMs !== null ? taps(s.repIdx, s.repStartMs) : undefined;
    const r = tickDefenderBlock(s, t, { triggerAtMs: tap !== undefined && t >= tap ? tap : undefined });
    tones += r.actions.length;
    s = r.state;
  }
  return { s, tones };
}

describe('defender block (task 2.4)', () => {
  it('runs every rep with planned timing, labelled as such, and ends', () => {
    const { s, tones } = run(cfg());
    expect(s.done).toBe(true);
    expect(tones).toBe(16);
    expect(s.scenarios).toHaveLength(16);
    expect(new Set(s.scenarios.map((x) => x.triggerSource))).toEqual(new Set(['plannedTiming']));
    // The trigger falls when the defender has settled.
    const first = s.scenarios[0];
    expect(first.cueEvents[1].atMs - first.cueEvents[0].atMs).toBe(plannedTriggerMs(s.plan[0]));
  });

  it('seeded blocks replay identically; a different seed differs', () => {
    expect(run(cfg()).s.scenarios).toEqual(run(cfg()).s.scenarios);
    expect(run(cfg({ seed: 7 })).s.scenarios).not.toEqual(run(cfg()).s.scenarios);
  });

  it('approaches vary in angle, speed and side', () => {
    const { s } = run(cfg());
    expect(new Set(s.plan.slice(0, 16).map((r) => r.initialSide)).size).toBeGreaterThan(1);
    expect(new Set(s.plan.slice(0, 16).map((r) => r.approachAngleDeg)).size).toBeGreaterThan(4);
  });

  it('a parent tap triggers the reaction and is labelled; no tap falls back to planned timing', () => {
    const tapped = run(cfg({ trigger: 'parentTrigger' }), (rep, start) => (rep % 2 === 0 ? start + 3000 : undefined)).s;
    expect(tapped.scenarios[0].triggerSource).toBe('parentTrigger');
    expect(tapped.scenarios[0].cueEvents[1].atMs - tapped.scenarios[0].cueEvents[0].atMs).toBe(3000);
    expect(tapped.scenarios[1].triggerSource).toBe('plannedTiming');
    expect(tapped.scenarios[1].cueEvents[1].atMs - tapped.scenarios[1].cueEvents[0].atMs).toBe(plannedTriggerMs(tapped.plan[1]) + TRIGGER_TIMEOUT_MS);
  });

  it('the correct exit is never shown as anything but the final defender position', () => {
    const { s } = run(cfg({ archetype: 'earlyCommit' }));
    for (const x of s.scenarios) {
      if (x.reaction === 'hold' || x.recovery) expect(x.correctExit).toBe('protect');
      else expect(x.correctExit).toBe(x.commitDirection === 'left' ? 'right' : 'left');
    }
  });
});
