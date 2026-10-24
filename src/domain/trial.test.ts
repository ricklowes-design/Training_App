import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { rec } from '../test/factories';
import { countsForWeek } from './records';
import { areaProgress } from './sequencing';
import { canDemote, demote, promote, trialSuggestion } from './trial';

const p = loadProgramme();
const placement = { areaId: 'scanning', startSession: 1, proposed: 1, overridden: false, explanation: '', date: '' };
const now = new Date('2026-11-05T12:00:00Z');

describe('trial mode (plan/13 §13.5)', () => {
  it('a trial unlocks nothing and is absent from the week', () => {
    const t = rec({ areaId: 'scanning', sessionNumber: 1, trial: true });
    expect(areaProgress(p, 'scanning', placement, [t]).next).toBe(1);
    expect(countsForWeek(t)).toBe(false);
  });

  it('Keep this keeps the original date and unlocks the next session', () => {
    const t = rec({ areaId: 'scanning', sessionNumber: 1, trial: true, date: '2026-11-01T18:00:00Z' });
    const kept = promote(t, now);
    expect(kept.date).toBe('2026-11-01T18:00:00Z');
    expect(kept.promotedAt).toBe(now.toISOString());
    expect(areaProgress(p, 'scanning', placement, [kept]).next).toBe(2);
    expect(countsForWeek(kept)).toBe(true);
  });

  it('a kept partial trial still does not unlock (completion rules apply)', () => {
    const kept = promote(rec({ areaId: 'scanning', sessionNumber: 1, trial: true, status: 'partial' }), now);
    expect(areaProgress(p, 'scanning', placement, [kept]).next).toBe(1);
  });

  it('demotion reverses the unlock when nothing depends on it', () => {
    const r1 = rec({ areaId: 'scanning', sessionNumber: 1, date: '2026-11-03T18:00:00Z' });
    const d = demote(r1, [r1], 'timer bug', now);
    expect(d.unlockRetained).toBe(false);
    expect(areaProgress(p, 'scanning', placement, [d]).next).toBe(1);
    expect(countsForWeek(d)).toBe(false);
  });

  it('demotion keeps the unlock when a later session depends on it', () => {
    const r1 = rec({ areaId: 'scanning', sessionNumber: 1, date: '2026-11-02T18:00:00Z' });
    const r2 = rec({ areaId: 'scanning', sessionNumber: 2, date: '2026-11-04T18:00:00Z' });
    const d = demote(r1, [r1, r2], 'timer bug', now);
    expect(d.unlockRetained).toBe(true);
    expect(areaProgress(p, 'scanning', placement, [d, r2]).next).toBe(3);
    expect(countsForWeek(d)).toBe(false);
  });

  it('demotion is limited to 7 days', () => {
    expect(canDemote(rec({ date: '2026-11-01T12:00:00Z' }), now).ok).toBe(true);
    expect(canDemote(rec({ date: '2026-10-28T11:00:00Z' }), now).ok).toBe(false);
  });

  it('suggests trial for a first drill run, after an update, and forces it in a trial period', () => {
    const settings = { lastSeenAppVersion: '0.1.0', lastSeenContentVersion: '0.2.0' };
    const done = rec({ blocks: [{ index: 1, kind: 'work', attempt: 1, drillId: 'F2', plannedS: 1, elapsedS: 1, ranToEnd: true, doneEarly: false, skipped: false, mode: 'reps' }] });
    const base = { records: [done], settings, appVersion: '0.1.0', contentVersion: '0.2.0', now };
    expect(trialSuggestion({ ...base, drillIds: ['F2'] }).suggested).toBe(false);
    expect(trialSuggestion({ ...base, drillIds: ['F2', 'F7'] }).reasons).toEqual(['First run of F7.']);
    expect(trialSuggestion({ ...base, drillIds: ['F2'], appVersion: '0.2.0' }).reasons).toEqual(['First session after an app update.']);
    const forced = trialSuggestion({ ...base, drillIds: ['F2'], settings: { ...settings, trialUntil: '2026-11-10' } });
    expect(forced.forced).toBe(true);
  });
});
