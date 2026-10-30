import { describe, expect, it } from 'vitest';
import type { Advancement, Placement, SessionRecord } from '../db/types';
import { loadProgramme } from '../test/fixtures';
import { rec } from '../test/factories';
import { areaProgress, nextForArea, proposePlacement, sessionLock, suggestNext, weekStart } from './sequencing';

const p = loadProgramme();
const placed = (areaId: string, startSession: number): Placement => ({ areaId, startSession, proposed: startSession, overridden: false, explanation: '', date: '2026-11-01' });
const placements = [placed('scanning', 1), placed('feinting', 5), placed('dribbling', 5), placed('control', 3)];
const prog = (areaId: string, records: SessionRecord[], adv: Advancement[] = []) =>
  areaProgress(p, areaId, placements.find((x) => x.areaId === areaId), records, adv);

describe('sequencing (plan/04 §4.6 worked example)', () => {
  const records: SessionRecord[] = [];
  const add = (r: Partial<SessionRecord>) => records.push(rec(r));

  it('starts at the placements', () => {
    expect(prog('scanning', records).next).toBe(1);
    expect(prog('feinting', records).next).toBe(5);
    expect(prog('control', records).next).toBe(3);
  });

  it('week 1: completed and benchmark-skipped both unlock', () => {
    add({ areaId: 'scanning', sessionNumber: 1, date: '2026-11-03T18:00:00Z' });
    add({ areaId: 'feinting', sessionNumber: 5, date: '2026-11-06T18:00:00Z' });
    add({ areaId: 'control', sessionNumber: 3, status: 'completedBenchmarkSkipped', date: '2026-11-08T18:00:00Z' });
    expect(prog('scanning', records).next).toBe(2);
    expect(prog('feinting', records).next).toBe(6);
    expect(prog('control', records).next).toBe(4);
  });

  it('week 2: stopped does not unlock; not started leaves it next; areas are independent', () => {
    add({ areaId: 'scanning', sessionNumber: 2, date: '2026-11-10T18:00:00Z' });
    add({ areaId: 'feinting', sessionNumber: 6, status: 'stopped', date: '2026-11-15T18:00:00Z' });
    expect(prog('scanning', records).next).toBe(3);
    expect(prog('feinting', records).next).toBe(6);
    expect(prog('dribbling', records).next).toBe(5);
  });

  it('partial stays next', () => {
    const r = [...records, rec({ areaId: 'feinting', sessionNumber: 6, status: 'partial' })];
    expect(prog('feinting', r).next).toBe(6);
  });

  it('week 3: the missed session is simply done now', () => {
    add({ areaId: 'dribbling', sessionNumber: 5, date: '2026-11-17T18:00:00Z' });
    add({ areaId: 'feinting', sessionNumber: 6, date: '2026-11-19T18:00:00Z' });
    expect(prog('dribbling', records).next).toBe(6);
    expect(prog('feinting', records).next).toBe(7);
  });

  it('extras, anchors and trials never unlock', () => {
    const r = [
      rec({ areaId: 'scanning', sessionNumber: 1, kind: 'programme' }),
      rec({ areaId: 'scanning', sessionNumber: 2, kind: 'extra' }),
      rec({ areaId: 'scanning', sessionNumber: 2, trial: true }),
    ];
    expect(prog('scanning', r).next).toBe(2);
  });

  it('a promoted trial unlocks', () => {
    const r = [rec({ areaId: 'scanning', sessionNumber: 1, trial: true, promotedAt: '2026-11-04T00:00:00Z' })];
    expect(prog('scanning', r).next).toBe(2);
  });

  it('later sessions are locked with a one-line reason', () => {
    const pr = prog('scanning', []);
    expect(sessionLock(p, pr, 1)).toEqual({ locked: false });
    expect(sessionLock(p, pr, 3)).toEqual({ locked: true, reason: 'Complete Session 1 first.' });
  });

  it('an unplaced area is locked except its baseline', () => {
    const pr = areaProgress(p, 'scanning', undefined, []);
    expect(pr.placed).toBe(false);
    expect(sessionLock(p, pr, 1).locked).toBe(true);
  });
});

describe('stage boundaries', () => {
  const s1to4 = [1, 2, 3, 4].map((n) => rec({ areaId: 'scanning', sessionNumber: n }));

  it('the first session of a new stage waits for the confirmed advancement', () => {
    const pr = prog('scanning', s1to4);
    expect(pr.next).toBe(5);
    expect(pr.awaitingAdvancement).toBe(true);
    expect(sessionLock(p, pr, 5)).toEqual({ locked: true, reason: 'Stage 2 unlocks when the criteria are met and a parent confirms.' });
  });

  it('a confirmed advancement unlocks it', () => {
    const adv: Advancement = { areaId: 'scanning', from: 'st1', to: 'st2', date: '2026-11-20', decision: 'confirmed', criteriaText: '', author: 'parent' };
    const pr = prog('scanning', s1to4, [adv]);
    expect(pr.awaitingAdvancement).toBe(false);
    expect(sessionLock(p, pr, 5)).toEqual({ locked: false });
  });

  it('while waiting, the suggestion is to repeat the stage\'s last benchmark session', () => {
    expect(nextForArea(p, prog('scanning', s1to4))).toEqual({ kind: 'repeatForCriteria', areaId: 'scanning', sessionNumber: 4 });
  });
});

describe('next-session suggestion', () => {
  const now = new Date('2026-11-05T12:00:00'); // Thursday
  const base = { programme: p, placements, advancements: [], now, weekStartDay: 1, priorities: [] };

  it('baselines come first for unplaced areas', () => {
    expect(suggestNext({ ...base, placements: [], records: [] })).toEqual({ kind: 'baseline', areaId: 'scanning' });
  });

  it('picks the area with the fewest completed sessions this week, then the least recently practised', () => {
    const records = [
      rec({ areaId: 'scanning', sessionNumber: 1, date: '2026-11-03T18:00:00' }),
      rec({ areaId: 'feinting', sessionNumber: 5, date: '2026-10-20T18:00:00' }),
      rec({ areaId: 'dribbling', sessionNumber: 5, date: '2026-10-25T18:00:00' }),
      rec({ areaId: 'control', sessionNumber: 3, date: '2026-10-28T18:00:00' }),
    ];
    expect(suggestNext({ ...base, records })).toEqual({ kind: 'session', areaId: 'feinting', sessionNumber: 6 });
  });

  it('coach priorities break ties', () => {
    expect(suggestNext({ ...base, records: [], priorities: ['left foot'] })).toEqual({ kind: 'session', areaId: 'control', sessionNumber: 3 });
  });

  it('weeks start on the configured day', () => {
    expect(weekStart(new Date('2026-11-05T12:00:00'), 1).getDate()).toBe(2);
    expect(weekStart(new Date('2026-11-05T12:00:00'), 0).getDate()).toBe(1);
  });
});

describe('baseline placement', () => {
  it('proposes from the yes count and explains why', () => {
    const r = proposePlacement(p, 'dribbling', [true, true, true]);
    expect(r.startSession).toBe(5);
    expect(r.explanation).toMatch(/^Stage 2 Session 5 because 3 of 3 answers were yes/);
    expect(proposePlacement(p, 'dribbling', [false, false, false]).startSession).toBe(1);
  });
});

describe('skip-ahead (part 15 D12)', () => {
  it('a confirmed advancement passes over the rest of the earlier stage, which stays repeatable', () => {
    const placement = { areaId: 'scanning', startSession: 1, proposed: 1, overridden: false, explanation: '', date: '' };
    const recs = [1, 2].map((n) => rec({ areaId: 'scanning', sessionNumber: n }));
    const before = areaProgress(p, 'scanning', placement, recs, []);
    expect(before.next).toBe(3);
    const adv = [{ areaId: 'scanning', from: 'st1', to: 'st2', date: '2026-11-30', decision: 'confirmed' as const, criteriaText: '', author: 'parent' }];
    const after = areaProgress(p, 'scanning', placement, recs, adv);
    expect(after.next).toBe(5);
    expect(after.skipped).toEqual([3, 4]);
    expect(after.awaitingAdvancement).toBe(false);
    expect(sessionLock(p, after, 3).locked).toBe(false);
  });
});

describe('weekly allocation and the availability calendar (task 5.3)', () => {
  it('equal shares keep the fewest-this-week rule; a larger share keeps an area suggested longer', async () => {
    const { suggestNext } = await import('./sequencing');
    const { loadProgramme } = await import('../test/fixtures');
    const { rec } = await import('../test/factories');
    const p = loadProgramme();
    const now = new Date('2026-11-05T12:00:00');
    const placements = p.areas.map((a) => ({ areaId: a.id, startSession: 1, date: '2026-11-01T00:00:00Z', explanation: '' }));
    const [a, b, c, d] = p.areas.map((x) => x.id);
    const done = (areaId: string, day: number, hour = 18) => rec({ areaId, sessionNumber: 1, date: `2026-11-0${day}T${hour}:00:00` });
    const base = { programme: p, placements: placements as never[], advancements: [], now, weekStartDay: 1, priorities: [] };
    // This week: a once, b, c and d twice each.
    const records = [done(a, 3), done(b, 3), done(c, 3), done(d, 3), done(b, 4), done(c, 4), done(d, 4)];
    expect(suggestNext({ ...base, records })?.areaId).toBe(a); // equal shares: the fewest
    // a twice too: with equal shares the tie goes to the least recently practised (b, c or d);
    // with a 3x share, two sessions are still the furthest below a's share.
    const more = [...records, done(a, 4, 20)];
    expect(suggestNext({ ...base, records: more })?.areaId).not.toBe(a);
    expect(suggestNext({ ...base, records: more, allocation: { [a]: 3 } })?.areaId).toBe(a);
    // Half a share: one session already fills it, so another area comes first.
    expect(suggestNext({ ...base, records: [done(a, 3)], allocation: { [a]: 0.5 } })?.areaId).not.toBe(a);
  });

  it('a calendar entry decides the day; otherwise the weekly game days', async () => {
    const { dayKind } = await import('./sequencing');
    const d = new Date('2026-11-07T10:00:00'); // a Saturday
    expect(dayKind({ gameDays: [] }, d)).toBe('normal');
    expect(dayKind({ gameDays: [6] }, d)).toBe('game');
    expect(dayKind({ gameDays: [6], availability: [{ date: '2026-11-07', kind: 'rest' }] }, d)).toBe('rest');
    expect(dayKind({ gameDays: [], availability: [{ date: '2026-11-07', kind: 'light' }] }, d)).toBe('light');
  });
});

describe('placement and stage confirmations (audit 2026-10-29, task 2)', () => {
  const conf = (date: string): Advancement => ({ areaId: 'scanning', from: 'st1', to: 'st2', decision: 'confirmed', date }) as Advancement;

  it('a newer placement resets earlier stage confirmations', () => {
    const replaced: Placement = { ...placed('scanning', 1), date: '2026-12-01T10:00:00Z' };
    const pr = areaProgress(p, 'scanning', replaced, [], [conf('2026-11-20T10:00:00Z')]);
    expect(pr.next).toBe(1);
    expect(pr.skipped).toEqual([]);
  });

  it('a confirmation after the placement still raises the stage', () => {
    const pl: Placement = { ...placed('scanning', 1), date: '2026-11-01T10:00:00Z' };
    const pr = areaProgress(p, 'scanning', pl, [], [conf('2026-11-20T10:00:00Z')]);
    expect(pr.next).toBe(5);
  });
});
