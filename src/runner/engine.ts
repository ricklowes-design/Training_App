import type { BlockResult, Pause } from '../db/types';
import type { RunBlock, RunPlan } from '../domain/plans';

// The session runner as a pure state machine. Time is passed in (ms), so the
// browser's timer throttling cannot drift it and tests can drive it.

export type Phase = 'demo' | 'countdown' | 'active' | 'card' | 'done';

/** Blocks that show the demonstration view first and the end-of-drill card after. */
export const isDrillBlock = (b: RunBlock) => b.kind === 'work' || b.kind === 'benchmark' || b.kind === 'anchor' || b.kind === 'quiz';
/** Blocks that start with the spoken countdown (time to walk to the start cone). */
const needsCountdown = (b: RunBlock) => isDrillBlock(b) || b.kind === 'warmup';

export interface RunState {
  plan: RunPlan;
  blockIdx: number;
  attempt: number;
  phase: Phase;
  phaseStartMs: number;
  activeMs: number; // active time banked before the current running segment
  segStartMs: number | null; // start of the current running (unpaused) segment
  pausedAtMs: number | null;
  pauses: Pause[];
  results: BlockResult[];
  stopped: boolean;
  fired: string[]; // announcements already made in this phase
  sessionStartMs: number;
}

export type RunEvent = { type: 'say'; text: string } | { type: 'tone'; kind: 'start' | 'end' | 'tick' | 'warn' | 'cue' } | { type: 'blockEnded'; result: BlockResult };

export interface Labels {
  blockName: (b: RunBlock) => string;
  warmupSteps: string[];
  countdownS: number;
  /** The drill's sets, when its content gives them. */
  setsFor?: (b: RunBlock) => { count: number; labels?: string[] } | undefined;
  /** Where the player starts for this block, said with "Walk to the start". */
  startFor?: (b: RunBlock) => string | undefined;
}

const ORDINAL = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Which set a block is in: its time split evenly into the sets (1-based index), or null without sets. */
export function setAt(sets: { count: number; labels?: string[] } | undefined, elapsedS: number, totalS: number): { index: number; count: number; label?: string } | null {
  if (!sets || sets.count < 2 || totalS <= 0) return null;
  const i = Math.max(0, Math.min(sets.count - 1, Math.floor(elapsedS / (totalS / sets.count))));
  return { index: i + 1, count: sets.count, label: sets.labels?.[i] };
}

const setSay = (x: { index: number; label?: string }) => `Set ${ORDINAL[x.index - 1] ?? x.index}.${x.label ? ` ${x.label}.` : ''}`;

export function initRun(plan: RunPlan, now: number): RunState {
  const first = plan.blocks[0];
  return {
    plan,
    blockIdx: 0,
    attempt: 1,
    phase: isDrillBlock(first) ? 'demo' : 'countdown',
    phaseStartMs: now,
    activeMs: 0,
    segStartMs: null,
    pausedAtMs: null,
    pauses: [],
    results: [],
    stopped: false,
    fired: [],
    sessionStartMs: now,
  };
}

export const currentBlock = (s: RunState) => s.plan.blocks[s.blockIdx];

export function activeElapsedMs(s: RunState, now: number): number {
  return s.activeMs + (s.segStartMs !== null ? now - s.segStartMs : 0);
}

export function remainingS(s: RunState, now: number): number {
  const b = currentBlock(s);
  if (s.phase === 'countdown') return 0;
  return Math.max(0, b.minutes * 60 - activeElapsedMs(s, now) / 1000);
}

export function countdownLeftS(s: RunState, now: number, countdownS: number): number {
  return Math.max(0, countdownS - (now - s.phaseStartMs) / 1000);
}

function enterPhase(s: RunState, phase: Phase, now: number): RunState {
  return { ...s, phase, phaseStartMs: now, fired: [] };
}

function startActive(s: RunState, now: number): RunState {
  return { ...enterPhase(s, 'active', now), activeMs: 0, segStartMs: now };
}

/** Moves to the block at `idx` (or finishes the session). */
function gotoBlock(s: RunState, idx: number, now: number): RunState {
  if (idx >= s.plan.blocks.length) return enterPhase({ ...s, blockIdx: s.plan.blocks.length - 1 }, 'done', now);
  const b = s.plan.blocks[idx];
  const next = { ...s, blockIdx: idx, attempt: 1, activeMs: 0, segStartMs: null };
  if (isDrillBlock(b)) return enterPhase(next, 'demo', now);
  if (needsCountdown(b)) return enterPhase(next, 'countdown', now);
  return startActive(next, now);
}

function makeResult(s: RunState, now: number, how: 'end' | 'done' | 'skip'): BlockResult {
  const b = currentBlock(s);
  const elapsedS = Math.round(activeElapsedMs(s, now) / 100) / 10;
  return {
    index: s.blockIdx,
    kind: b.kind,
    attempt: s.attempt,
    drillId: b.drillId,
    benchmarkId: b.benchmarkId,
    anchorId: b.anchorId,
    areaId: b.areaId,
    plannedS: b.minutes * 60,
    elapsedS: how === 'skip' ? 0 : Math.min(elapsedS, b.minutes * 60),
    ranToEnd: how === 'end',
    doneEarly: how === 'done',
    skipped: how === 'skip',
    mode: b.mode,
  };
}

function finishBlock(s: RunState, now: number, how: 'end' | 'done'): { state: RunState; events: RunEvent[] } {
  const result = makeResult(s, now, how);
  const b = currentBlock(s);
  const banked = { ...s, activeMs: activeElapsedMs(s, now), segStartMs: null, results: [...s.results, result] };
  const events: RunEvent[] = [{ type: 'tone', kind: 'end' }, { type: 'blockEnded', result }];
  if (isDrillBlock(b)) return { state: enterPhase(banked, 'card', now), events };
  return { state: gotoBlock(banked, s.blockIdx + 1, now), events };
}

/** Advance the clock. Returns the new state and what to say or play. */
export function tick(s: RunState, now: number, labels: Labels): { state: RunState; events: RunEvent[] } {
  const events: RunEvent[] = [];
  const once = (key: string, ev: RunEvent | RunEvent[]) => {
    if (s.fired.includes(key)) return;
    s = { ...s, fired: [...s.fired, key] };
    events.push(...(Array.isArray(ev) ? ev : [ev]));
  };
  if (s.pausedAtMs !== null || s.phase === 'done') return { state: s, events };
  const b = currentBlock(s);

  if (s.phase === 'countdown') {
    const left = countdownLeftS(s, now, labels.countdownS);
    once('intro', { type: 'say', text: b.kind === 'warmup' ? `Warm-up in ${labels.countdownS} seconds.` : `${labels.blockName(b)} in ${labels.countdownS} seconds. Walk to the start.${labels.startFor?.(b) ? ` ${labels.startFor(b)}` : ''}` });
    for (const n of [3, 2, 1]) if (left <= n && left > n - 1) once(`c${n}`, { type: 'tone', kind: 'tick' });
    if (left <= 0) {
      s = startActive(s, now);
      const first = setAt(labels.setsFor?.(b), 0, b.minutes * 60);
      events.push({ type: 'tone', kind: 'start' }, { type: 'say', text: first ? `${setSay(first)} Go.` : 'Go.' });
    }
    return { state: s, events };
  }

  if (s.phase === 'active') {
    const total = b.minutes * 60;
    const elapsed = activeElapsedMs(s, now) / 1000;
    const left = total - elapsed;
    if (b.kind === 'warmup' && labels.warmupSteps.length) {
      const per = total / labels.warmupSteps.length;
      const step = Math.min(labels.warmupSteps.length - 1, Math.floor(elapsed / per));
      once(`step${step}`, { type: 'say', text: labels.warmupSteps[step] });
    } else if (['rest', 'transition', 'break'].includes(b.kind)) {
      const next = s.plan.blocks[s.blockIdx + 1];
      once('rest', { type: 'say', text: `${labels.blockName(b)}.${next ? ` Next: ${labels.blockName(next)}.` : ''}` });
    } else if (b.kind === 'cooldown' || b.kind === 'mobility' || b.kind === 'log') {
      once('intro', { type: 'say', text: labels.blockName(b) + '.' });
    }
    const set = ['warmup', 'rest', 'transition', 'break', 'cooldown', 'mobility', 'log'].includes(b.kind) ? null : setAt(labels.setsFor?.(b), elapsed, total);
    if (set && set.index > 1) once(`set${set.index}`, [{ type: 'tone', kind: 'tick' }, { type: 'say', text: setSay(set) }]);
    // With sets, the set announcements replace "Half way."
    if (!set && total >= 120 && left <= total / 2 && left > 30) once('half', { type: 'say', text: 'Half way.' });
    if (total >= 90 && left <= 30 && left > 0) once('30', [{ type: 'tone', kind: 'warn' }, { type: 'say', text: 'Thirty seconds.' }]);
    if (left <= 0) {
      const r = finishBlock(s, now, 'end');
      return { state: r.state, events: [...events, ...r.events] };
    }
    return { state: s, events };
  }
  return { state: s, events };
}

/** One tap on the demo view: start the countdown. */
export function startBlock(s: RunState, now: number): RunState {
  if (s.phase !== 'demo') return s;
  return enterPhase(s, 'countdown', now);
}

/** DONE: ends the current block early (rep-based blocks, and benchmark runs). */
export function done(s: RunState, now: number): { state: RunState; events: RunEvent[] } {
  if (s.phase !== 'active' || s.pausedAtMs !== null) return { state: s, events: [] };
  return finishBlock(s, now, 'done');
}

/** Skip the block from its demo view (or a rest). Recorded as skipped. */
export function skip(s: RunState, now: number): { state: RunState; events: RunEvent[] } {
  if (s.phase === 'done' || s.phase === 'card') return { state: s, events: [] };
  const result = makeResult(s, now, 'skip');
  const st = gotoBlock({ ...s, results: [...s.results, result], pausedAtMs: null }, s.blockIdx + 1, now);
  return { state: st, events: [{ type: 'blockEnded', result }] };
}

export function pause(s: RunState, now: number): RunState {
  if (s.pausedAtMs !== null || s.phase === 'done') return s;
  return { ...s, pausedAtMs: now, activeMs: activeElapsedMs(s, now), segStartMs: null };
}

export function resume(s: RunState, now: number): RunState {
  if (s.pausedAtMs === null) return s;
  const pauses = [...s.pauses, { startMs: s.pausedAtMs, endMs: now }];
  const shifted = s.phase === 'countdown' || s.phase === 'demo' ? { phaseStartMs: s.phaseStartMs + (now - s.pausedAtMs) } : {};
  return { ...s, ...shifted, pausedAtMs: null, pauses, segStartMs: s.phase === 'active' ? now : null };
}

/** STOP on any practice view: the session ends as stopped. */
export function stop(s: RunState, now: number): RunState {
  const closed = s.pausedAtMs !== null ? { ...s, pauses: [...s.pauses, { startMs: s.pausedAtMs, endMs: now }], pausedAtMs: null } : s;
  return enterPhase({ ...closed, stopped: true }, 'done', now);
}

/** Repeat from the end-of-drill card: the same block again as the next attempt. */
/** Back to this block's instructions (demo view), from its countdown or while it runs. Nothing is recorded
 *  for the interrupted run; the block starts again from the beginning. */
export function restartWithInstructions(s: RunState, now: number): RunState {
  if ((s.phase !== 'countdown' && s.phase !== 'active') || !isDrillBlock(currentBlock(s))) return s;
  return enterPhase({ ...s, activeMs: 0, segStartMs: null, pausedAtMs: null }, 'demo', now);
}

export function repeat(s: RunState, now: number): RunState {
  if (s.phase !== 'card') return s;
  return enterPhase({ ...s, attempt: s.attempt + 1, activeMs: 0, segStartMs: null }, 'countdown', now);
}

/** Next from the end-of-drill card. */
export function next(s: RunState, now: number): RunState {
  if (s.phase !== 'card') return s;
  return gotoBlock(s, s.blockIdx + 1, now);
}
