import type { SessionRecord, Settings } from '../db/types';
import { countsForUnlock } from './records';
import { localDate } from './dates';

// Trial mode (plan/13 §13.5).

export const DEMOTE_WINDOW_DAYS = 7;

export interface TrialSuggestionInput {
  drillIds: string[];
  records: SessionRecord[];
  settings: Pick<Settings, 'trialUntil' | 'lastSeenAppVersion' | 'lastSeenContentVersion'>;
  appVersion: string;
  contentVersion: string;
  now: Date;
}

export interface TrialSuggestion {
  /** Inside the parent's trial period: the session is a trial and the toggle cannot be turned off. */
  forced: boolean;
  /** The app suggests trial (toggle pre-set on; one tap declines). */
  suggested: boolean;
  reasons: string[];
}

export function trialSuggestion(input: TrialSuggestionInput): TrialSuggestion {
  const { drillIds, records, settings, appVersion, contentVersion, now } = input;
  const reasons: string[] = [];
  const forced = !!settings.trialUntil && localDate(now) <= settings.trialUntil;
  if (forced) reasons.push(`All sessions are trials until ${settings.trialUntil}.`);

  const done = new Set(records.flatMap((r) => r.blocks.map((b) => b.drillId).filter(Boolean)));
  const newDrills = [...new Set(drillIds.filter((d) => d !== 'choice' && !done.has(d)))];
  if (newDrills.length) reasons.push(`First run of ${newDrills.join(', ')}.`);
  if (records.length > 0 && settings.lastSeenAppVersion && settings.lastSeenAppVersion !== appVersion) reasons.push('First session after an app update.');
  if (records.length > 0 && settings.lastSeenContentVersion && settings.lastSeenContentVersion !== contentVersion) {
    reasons.push('First session after a content change.');
  }
  return { forced, suggested: forced || reasons.length > 0, reasons };
}

/** A kept trial must not count a session that is already counted (audit task 17). */
export function canPromote(rec: SessionRecord, records: SessionRecord[]): { ok: true } | { ok: false; reason: string } {
  if (rec.kind === 'programme' && rec.areaId && rec.sessionNumber !== undefined) {
    const dup = records.some((r) => r.id !== rec.id && r.areaId === rec.areaId && r.sessionNumber === rec.sessionNumber && countsForUnlock(r));
    if (dup) return { ok: false, reason: `Session ${rec.sessionNumber} is already counted.` };
  }
  return { ok: true };
}

/** "Keep this": promote a trial. It keeps its date; its status was set by the completion rules when saved. */
export function promote(rec: SessionRecord, now: Date): SessionRecord {
  if (!rec.trial || rec.promotedAt || rec.kind === 'systemTest') return rec;
  return { ...rec, promotedAt: now.toISOString() };
}

export type DemoteCheck = { ok: true } | { ok: false; reason: string };

export function canDemote(rec: SessionRecord, now: Date): DemoteCheck {
  if (rec.demotedAt) return { ok: false, reason: 'Already a trial.' };
  if (rec.trial && !rec.promotedAt) return { ok: false, reason: 'Already a trial.' };
  const ageDays = (now.getTime() - new Date(rec.date).getTime()) / 86_400_000;
  if (ageDays > DEMOTE_WINDOW_DAYS) return { ok: false, reason: `Only sessions from the last ${DEMOTE_WINDOW_DAYS} days can be made a trial.` };
  return { ok: true };
}

/** Later recorded sessions in the same area whose unlock came after this one. */
export function dependents(rec: SessionRecord, records: SessionRecord[]): SessionRecord[] {
  if (rec.kind !== 'programme' || rec.sessionNumber === undefined) return [];
  return records.filter(
    (r) => r.id !== rec.id && r.areaId === rec.areaId && r.sessionNumber !== undefined && r.sessionNumber > (rec.sessionNumber as number) && countsForUnlock(r),
  );
}

/** "Make this a trial" (parent only). The unlock is reversed only when nothing later depends on it. */
export function demote(rec: SessionRecord, records: SessionRecord[], reason: string, now: Date): SessionRecord {
  const deps = dependents(rec, records);
  return { ...rec, demotedAt: now.toISOString(), demoteReason: reason, unlockRetained: deps.length > 0 };
}
