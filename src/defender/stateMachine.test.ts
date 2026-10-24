import { describe, expect, it } from 'vitest';
import { ENGAGE_Z, plannedTriggerMs, poseAt, repEndMs, START_Z, type DefenderMotion } from './stateMachine';

const m = (over: Partial<DefenderMotion>): DefenderMotion => ({ approachMs: 1800, approachAngleDeg: 10, initialSide: 'left', reaction: 'commit', commitDirection: 'left', strength: 0.8, reactionDelayMs: 250, recovery: false, ...over });
const end = (x: DefenderMotion) => poseAt(x, repEndMs(x, plannedTriggerMs(x)) - 10, plannedTriggerMs(x));

describe('defender state machine (task 2.2)', () => {
  it('approaches from far to the engagement distance, from the stated side', () => {
    const x = m({});
    const start = poseAt(x, 0, null);
    expect(start.state).toBe('approach');
    expect(start.z).toBeCloseTo(START_Z);
    expect(start.x).toBeLessThan(0);
    const settled = poseAt(x, x.approachMs + 100, null);
    expect(settled.state).toBe('stance');
    expect(settled.z).toBeCloseTo(ENGAGE_Z);
  });

  it('waits in its stance until the trigger and the reaction delay', () => {
    const x = m({});
    const trig = plannedTriggerMs(x);
    expect(poseAt(x, trig + 100, trig).state).toBe('reading');
    expect(poseAt(x, trig + 100, trig).x).toBeCloseTo(poseAt(x, trig - 100, null).x, 0);
    expect(poseAt(x, trig + x.reactionDelayMs + 400, trig).state).toBe('commit');
  });

  it('commits left and right are mirror images, clearly to one side', () => {
    const l = end(m({ commitDirection: 'left' }));
    const r = end(m({ commitDirection: 'right' }));
    expect(l.x).toBeLessThan(-0.4);
    expect(r.x).toBeGreaterThan(0.4);
    expect(l.x).toBeCloseTo(-r.x);
    expect(Math.sign(l.lean)).toBe(-1);
  });

  it('a hold shows no lateral move', () => {
    const h = end(m({ reaction: 'hold', commitDirection: undefined }));
    expect(Math.abs(h.x)).toBeLessThan(0.05);
    expect(h.z).toBeGreaterThan(ENGAGE_Z);
  });

  it('a late reaction stays in its stance longer, then steps', () => {
    const d = m({ reaction: 'delay', commitDirection: 'right' });
    const trig = plannedTriggerMs(d);
    expect(poseAt(d, trig + d.reactionDelayMs + 200, trig).state).toBe('reading');
    expect(end(d).x).toBeGreaterThan(0.3);
  });

  it('commit-then-recover goes to the side and comes back in front', () => {
    const c = m({ reaction: 'commitThenRecover', recovery: true, commitDirection: 'right' });
    const trig = plannedTriggerMs(c);
    expect(poseAt(c, trig + c.reactionDelayMs + 330, trig).x).toBeGreaterThan(0.4);
    expect(Math.abs(end(c).x)).toBeLessThan(0.05);
  });

  it('is deterministic', () => {
    const x = m({ reaction: 'commitThenRecover', recovery: true });
    for (const t of [0, 500, 2000, 2600, 3500]) expect(poseAt(x, t, 2200)).toEqual(poseAt(x, t, 2200));
  });
});
