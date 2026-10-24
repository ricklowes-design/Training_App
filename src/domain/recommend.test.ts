import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { rec, result } from '../test/factories';
import { reasonsFor, type RecInput } from './recommend';

const p = loadProgramme();
const base: RecInput = { programme: p, placements: [{ areaId: 'feinting', startSession: 1, proposed: 1, overridden: false, explanation: '', date: '' }], records: [], results: [], advancements: [], transfers: [], extraCriteria: [], observations: [], now: new Date('2026-11-20T10:00:00') };

describe('recommendation reasons (task 5.3)', () => {
  it('names the weaker foot, open criteria and spacing', () => {
    const r1 = rec({ id: 'r1', areaId: 'feinting', sessionNumber: 3, date: '2026-11-10T18:00:00' });
    const fb = result({ sessionRecordId: 'r1', benchmarkId: 'FB', areaId: 'feinting', date: '2026-11-10T18:30:00', values: { kind: 'FB', left: { sell: 4, exit: 4, eyes: 4 }, right: { sell: 8, exit: 8, eyes: 8 } }, conditions: { layoutVersion: 1, cueLevel: 'walk', floor: 'hard', recorded: false, recordedBy: 'parent' } });
    const why = reasonsFor({ ...base, records: [r1], results: [fb] }, 'feinting');
    expect(why).toContain('left foot at 50% of right on the last Feint rubric');
    expect(why.some((w) => /^stage criteria met on 0 of 2 required days$/.test(w))).toBe(true);
    expect(why).toContain('last practised 9 days ago');
  });
  it('explains the weaker link between reading and control', () => {
    const o = (metricId: string, value: number) => ({ metricId, value, unit: '/16', status: 'verified' as const, source: 'manual' as const, recordedAt: '2026-11-19', contextKey: { drillId: 'F5', layoutVersion: 1, cueLevel: 'x' } });
    expect(reasonsFor({ ...base, observations: [o('correctResponseByDefenderAction', 9), o('controlledExit', 14)] }, 'feinting')).toContain('reads of the defender lag behind ball control');
    expect(reasonsFor({ ...base, observations: [o('correctResponseByDefenderAction', 14), o('controlledExit', 9)] }, 'feinting')).toContain('chose well but lost the ball more often');
  });
  it('no data is an observation reason, not a penalty', () => {
    expect(reasonsFor(base, 'feinting')).toEqual(expect.arrayContaining(['no recent comparable result', 'not practised yet']));
  });
});
