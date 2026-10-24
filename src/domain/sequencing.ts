import type { Programme } from '../content/types';
import type { Advancement, Placement, SessionRecord } from '../db/types';
import { countsForUnlock, countsForWeek } from './records';

export interface AreaProgress {
  areaId: string;
  placed: boolean;
  start: number;
  completed: Set<number>;
  /** The next session to do, or null when every session is done. */
  next: number | null;
  /** True when `next` begins a new stage that still needs the parent's advancement confirmation. */
  awaitingAdvancement: boolean;
  /** Stage the player is in: the stage of `next` (or of the last session when finished). */
  stageId: string;
  totalSessions: number;
  /** Sessions passed over by an evidence-based skip-ahead (part 15 D12); they stay available to repeat. */
  skipped: number[];
}

export function stageOf(p: Programme, sessionNumber: number): string {
  return p.stages.find((s) => s.sessions.includes(sessionNumber))?.id ?? p.stages[p.stages.length - 1].id;
}

const stageOrder = (p: Programme, id: string) => p.stages.find((s) => s.id === id)?.order ?? 0;

/** Stage the area has been confirmed into: the placement stage, raised by each confirmed advancement. */
export function confirmedStage(p: Programme, areaId: string, placement: Placement | undefined, advancements: Advancement[]): string | null {
  if (!placement) return null;
  let stage = stageOf(p, placement.startSession);
  for (const a of advancements) {
    if (a.areaId === areaId && a.decision === 'confirmed' && a.to !== 'exit' && stageOrder(p, a.to) > stageOrder(p, stage)) stage = a.to;
  }
  return stage;
}

export function areaProgress(
  p: Programme,
  areaId: string,
  placement: Placement | undefined,
  records: SessionRecord[],
  advancements: Advancement[] = [],
): AreaProgress {
  const numbers = p.sessions.filter((s) => s.areaId === areaId).map((s) => s.number);
  const totalSessions = numbers.length ? Math.max(...numbers) : 0;
  const completed = new Set(
    records.filter((r) => r.areaId === areaId && countsForUnlock(r) && r.sessionNumber !== undefined).map((r) => r.sessionNumber as number),
  );
  if (!placement) {
    return { areaId, placed: false, start: 1, completed, next: null, awaitingAdvancement: false, stageId: p.stages[0].id, totalSessions, skipped: [] };
  }
  const confirmed = confirmedStage(p, areaId, placement, advancements);
  let n = placement.startSession;
  while (completed.has(n)) n++;
  // Skip-ahead: once a later stage is confirmed, the rest of the earlier stages are no longer required.
  const skipped: number[] = [];
  const firstOfConfirmed = Math.min(...(p.stages.find((st) => st.id === confirmed)?.sessions ?? [n]));
  while (n < firstOfConfirmed) {
    if (!completed.has(n)) skipped.push(n);
    n++;
  }
  while (completed.has(n)) n++;
  const next = n <= totalSessions ? n : null;
  const stageId = stageOf(p, next ?? totalSessions);
  const awaitingAdvancement = next !== null && confirmed !== null && stageOrder(p, stageId) > stageOrder(p, confirmed);
  return { areaId, placed: true, start: placement.startSession, completed, next, awaitingAdvancement, stageId, totalSessions, skipped };
}

export type SessionLock = { locked: false } | { locked: true; reason: string };

/** Whether a numbered session can be started as a programme session, and if not, the one-line reason. */
export function sessionLock(p: Programme, prog: AreaProgress, n: number): SessionLock {
  if (!prog.placed) return { locked: true, reason: 'Do the baseline for this area first.' };
  if (prog.completed.has(n)) return { locked: false };
  if (n < prog.start) return { locked: false };
  if (prog.next === null || n > prog.next) return { locked: true, reason: `Complete Session ${prog.next ?? n - 1} first.` };
  if (n === prog.next && prog.awaitingAdvancement) {
    const st = p.stages.find((s) => s.id === prog.stageId);
    return { locked: true, reason: `Stage ${st?.order} unlocks when the criteria are met and a parent confirms.` };
  }
  return { locked: false };
}

/** Local midnight at the start of the week that contains `d`. */
export function weekStart(d: Date, weekStartDay: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (x.getDay() - weekStartDay + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export type Suggestion =
  | { kind: 'baseline'; areaId: string }
  | { kind: 'session'; areaId: string; sessionNumber: number }
  | { kind: 'repeatForCriteria'; areaId: string; sessionNumber: number };

export interface SuggestInput {
  programme: Programme;
  placements: Placement[];
  records: SessionRecord[];
  advancements: Advancement[];
  now: Date;
  weekStartDay: number;
  priorities: string[];
}

/** The last completed session in the current stage that has a benchmark, for repeating while criteria are pending. */
function lastBenchmarkSessionBefore(p: Programme, areaId: string, before: number): number {
  const stageId = stageOf(p, before - 1);
  const stage = p.stages.find((s) => s.id === stageId);
  const candidates = (stage?.sessions ?? []).filter((n) => n < before).reverse();
  for (const n of candidates) {
    const s = p.sessions.find((x) => x.areaId === areaId && x.number === n);
    if (s?.blocks.some((b) => b.type === 'benchmark')) return n;
  }
  return before - 1;
}

export function nextForArea(p: Programme, prog: AreaProgress): Suggestion | null {
  if (!prog.placed) return { kind: 'baseline', areaId: prog.areaId };
  if (prog.next === null) return null;
  if (prog.awaitingAdvancement) return { kind: 'repeatForCriteria', areaId: prog.areaId, sessionNumber: lastBenchmarkSessionBefore(p, prog.areaId, prog.next) };
  return { kind: 'session', areaId: prog.areaId, sessionNumber: prog.next };
}

/** "Next session" (plan/02 §2.3): the area with the fewest completed sessions this week,
 *  then the one practised least recently; coach priorities break ties, then content order. */
export function suggestNext(input: SuggestInput): Suggestion | null {
  const { programme: p, placements, records, advancements, now, weekStartDay, priorities } = input;
  const ws = weekStart(now, weekStartDay).getTime();
  const rows = p.areas
    .map((a, order) => {
      const prog = areaProgress(p, a.id, placements.find((x) => x.areaId === a.id), records, advancements);
      const sugg = nextForArea(p, prog);
      const counted = records.filter((r) => r.areaId === a.id && countsForWeek(r));
      const thisWeek = counted.filter((r) => new Date(r.date).getTime() >= ws).length;
      const last = counted.reduce((m, r) => Math.max(m, new Date(r.date).getTime()), 0);
      const priority = a.priorityTags.some((t) => priorities.includes(t)) || priorities.includes(a.id) ? 0 : 1;
      return { sugg, thisWeek, last, priority, order };
    })
    .filter((r) => r.sugg !== null);
  rows.sort((x, y) => x.thisWeek - y.thisWeek || x.last - y.last || x.priority - y.priority || x.order - y.order);
  return rows[0]?.sugg ?? null;
}

/** Proposed starting session from the parent's yes/no answers, with the reason in words. */
export function proposePlacement(p: Programme, areaId: string, answers: boolean[]): { startSession: number; explanation: string } {
  const bl = p.baselines.find((b) => b.areaId === areaId);
  const yes = answers.filter(Boolean).length;
  const byYes = p.placementRule.byYesCount[String(yes)];
  const startSession = byYes ?? bl?.defaultStartSession ?? 1;
  const stage = p.stages.find((s) => s.sessions.includes(startSession));
  const answered = (bl?.questions ?? []).map((q, i) => `${answers[i] ? 'yes' : 'no'}: ${q}`).join('; ');
  return {
    startSession,
    explanation: `Stage ${stage?.order ?? '?'} Session ${startSession} because ${yes} of ${answers.length} answers were yes (${answered}).`,
  };
}
