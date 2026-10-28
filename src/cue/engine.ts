import type { CatchType, CueDrill } from '../content/types';

// Cue engine (task 17). Pure: time comes in as active block time in ms, so a
// pause freezes it, and tests drive it with a seeded random source.

export type Side = 'left' | 'right';

export interface CueConfig {
  drill: CueDrill;
  displayS: [number, number]; // how long a cue stays up (random in range)
  reps: number | null; // null = keep cycling until the block's timer ends
  useTripwire: boolean;
  fixedTripwireDelayMs?: number; // anchors: a fixed delay instead of the drill's random window
  catchFraction: number;
  catchTypes: CatchType[];
  secondCueFraction: number;
  seed?: number;
  /** No-information comparison block (part 16 §5): the value is drawn and logged but never shown. */
  hidden?: boolean;
  /** Wall drills: the cue comes on the sound of the ball hitting the wall (input.tripwireMs carries the bang).
   *  No bang heard in time: the cue shows on its own and the rep is logged as timed, without a bang. */
  soundTrigger?: boolean;
}

export interface PlannedRep {
  index: number;
  value: string;
  number?: number;
  catchType?: CatchType;
  second?: { value: string; delayMs: number };
  delayMs: number; // tripwire → cue (camera) or start tone → cue (no camera)
  displayMs: number;
}

export interface CueLogEntry {
  rep: number;
  repStartMs: number;
  trigger: 'tripwire' | 'timed' | 'interval' | 'sound';
  /** Sound-triggered rep where no bang was heard: the cue was shown on its own. */
  noBang?: boolean;
  tripwireMs?: number;
  missedTripwire?: boolean;
  cueMs?: number; // absent on a no-cue catch trial
  value?: string;
  number?: number;
  side?: Side; // for blocked-on-the-shaping-side catch trials
  catchType?: CatchType;
  secondCueMs?: number;
  secondValue?: string;
  plannedDelayMs: number;
  /** Logged but not shown (no-information comparison block). */
  hidden?: boolean;
}

export interface CueView {
  value: string;
  number?: number;
  side?: Side;
  second?: boolean;
}

export interface CueState {
  config: CueConfig;
  plan: PlannedRep[];
  repIdx: number;
  repStartMs: number | null;
  nextRepMs: number;
  cueAtMs: number | null; // scheduled cue time for the current rep
  shownAtMs: number | null;
  secondAtMs: number | null;
  hideAtMs: number | null;
  view: CueView | null;
  log: CueLogEntry[];
  done: boolean;
}

export type CueAction = { type: 'repTone' } | { type: 'cueTone' } | { type: 'say'; text: string };

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();

function shuffle<T>(arr: T[], r: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LATE_EXTRA_MS: [number, number] = [600, 900];

/** Reps with balanced values, catch trials spread through the block (never the first two), second cues on some reps. */
export function planReps(config: CueConfig): PlannedRep[] {
  const r = rng(config.seed ?? Date.now());
  const d = config.drill;
  const values = d.values?.length ? d.values : ['GO'];
  const n = config.reps ?? 200;
  const vals = shuffle(
    Array.from({ length: n }, (_, i) => values[i % values.length]),
    r,
  );
  const catchCount = config.catchTypes.length ? Math.round(n * config.catchFraction) : 0;
  const eligible = shuffle(
    Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 2),
    r,
  ).slice(0, catchCount);
  const catchAt = new Map(eligible.map((idx, k) => [idx, config.catchTypes[k % config.catchTypes.length]]));
  const sc = d.secondCue;
  return vals.map((value, index) => {
    const catchType = catchAt.get(index);
    const tripMin = config.fixedTripwireDelayMs ?? d.tripwireDelayMinMs ?? 0;
    const tripMax = config.fixedTripwireDelayMs ?? d.tripwireDelayMaxMs ?? 400;
    let delayMs = config.useTripwire ? between(r, tripMin, tripMax) : 1000 * between(r, d.startToCueMinS ?? 1, d.startToCueMaxS ?? 2);
    if (catchType === 'lateCue') delayMs += between(r, ...LATE_EXTRA_MS);
    // A second change of information ('*' = on any value, to a different value).
    const pool = sc ? sc.values.filter((v) => sc.onValue !== '*' || v !== value) : [];
    const second =
      sc && (value === sc.onValue || sc.onValue === '*') && !catchType && r() < config.secondCueFraction && pool.length
        ? { value: pool[Math.floor(r() * pool.length)], delayMs: between(r, sc.delayMinMs, sc.delayMaxMs) }
        : undefined;
    return {
      index,
      value: catchType === 'blockedShaping' ? 'BLOCKED' : value,
      number: d.numbers ? 1 + Math.floor(r() * 9) : undefined,
      catchType,
      second,
      delayMs: Math.round(delayMs),
      displayMs: Math.round(1000 * between(r, config.displayS[0], config.displayS[1])),
    };
  });
}

export function initCue(config: CueConfig): CueState {
  return {
    config,
    plan: planReps(config),
    repIdx: -1,
    repStartMs: null,
    nextRepMs: 0,
    cueAtMs: null,
    shownAtMs: null,
    secondAtMs: null,
    hideAtMs: null,
    view: null,
    log: [],
    done: false,
  };
}

export interface CueInput {
  /** Latest tripwire crossing (active ms), if the camera saw one. */
  tripwireMs?: number;
  /** Side her upper body moved toward just before the tripwire. */
  shapingSide?: Side;
}

const patchLast = (log: CueLogEntry[], patch: Partial<CueLogEntry>) => [...log.slice(0, -1), { ...log[log.length - 1], ...patch }];

function tickInterval(s: CueState, now: number): { state: CueState; actions: CueAction[] } {
  const d = s.config.drill;
  if (now < s.nextRepMs) return { state: s, actions: [] };
  const idx = s.repIdx + 1;
  const rep = s.plan[idx % s.plan.length];
  const r = rng((s.config.seed ?? 1) + idx * 7919);
  const gap = 1000 * between(r, d.intervalMinS ?? 2, d.intervalMaxS ?? 3);
  const entry: CueLogEntry = { rep: idx, repStartMs: now, trigger: 'interval', cueMs: now, value: rep.value, number: rep.number, plannedDelayMs: 0 };
  return {
    state: { ...s, repIdx: idx, repStartMs: now, nextRepMs: now + gap, view: { value: rep.value, number: rep.number }, shownAtMs: now, log: [...s.log, entry] },
    actions: [{ type: 'cueTone' }],
  };
}

export function tickCue(s: CueState, now: number, input: CueInput = {}): { state: CueState; actions: CueAction[] } {
  if (s.done) return { state: s, actions: [] };
  const d = s.config.drill;
  if ((d.trigger ?? 'rep') === 'interval') return tickInterval(s, now);
  const actions: CueAction[] = [];
  const periodMs = 1000 * (d.repPeriodS ?? 8);

  // Hide the cue when its time is up.
  if (s.view && s.hideAtMs !== null && now >= s.hideAtMs) s = { ...s, view: null, hideAtMs: null };

  // Start the next rep.
  if (now >= s.nextRepMs) {
    const idx = s.repIdx + 1;
    if (s.config.reps !== null && idx >= s.config.reps) return { state: { ...s, done: true, view: null }, actions };
    const rep = s.plan[idx % s.plan.length];
    const entry: CueLogEntry = { rep: idx, repStartMs: now, trigger: s.config.soundTrigger ? 'sound' : s.config.useTripwire ? 'tripwire' : 'timed', catchType: rep.catchType, plannedDelayMs: rep.delayMs };
    let side: Side | undefined;
    if (rep.catchType === 'blockedShaping' && !s.config.useTripwire) {
      // No camera: pre-announce the side to shape toward; BLOCKED will show on that side.
      side = (idx * 2654435761) % 2 === 0 ? 'left' : 'right';
      actions.push({ type: 'say', text: `Shape ${side}.` });
      entry.side = side;
    }
    actions.push({ type: 'repTone' });
    s = {
      ...s,
      repIdx: idx,
      repStartMs: now,
      nextRepMs: now + periodMs,
      cueAtMs: s.config.useTripwire ? null : now + rep.delayMs,
      shownAtMs: null,
      secondAtMs: null,
      view: null,
      hideAtMs: null,
      log: [...s.log, entry],
    };
  }

  const rep = s.plan[s.repIdx % s.plan.length];
  if (s.repStartMs === null || !rep) return { state: s, actions };

  // Tripwire: schedule the cue a short random delay after she crosses it.
  if (s.config.useTripwire && s.cueAtMs === null && s.shownAtMs === null) {
    const last = s.log[s.log.length - 1];
    if (input.tripwireMs !== undefined && input.tripwireMs >= s.repStartMs && !last.missedTripwire) {
      const side = rep.catchType === 'blockedShaping' ? input.shapingSide ?? 'left' : undefined;
      s = { ...s, cueAtMs: input.tripwireMs + rep.delayMs, log: patchLast(s.log, { tripwireMs: input.tripwireMs, side }) };
    } else if (s.config.soundTrigger && now >= s.repStartMs + Math.max(3000, periodMs - rep.displayMs - 1000)) {
      s = { ...s, cueAtMs: now, log: patchLast(s.log, { trigger: 'timed', noBang: true }) };
    } else if (!s.config.soundTrigger && now >= s.repStartMs + periodMs - 2000 && !last.missedTripwire) {
      s = { ...s, log: patchLast(s.log, { missedTripwire: true }) };
    }
  }

  // Show the cue.
  if (s.cueAtMs !== null && s.shownAtMs === null && now >= s.cueAtMs) {
    const last = s.log[s.log.length - 1];
    if (rep.catchType === 'noCue' || s.config.hidden) {
      s = { ...s, shownAtMs: s.cueAtMs, log: s.config.hidden ? patchLast(s.log, { cueMs: s.cueAtMs, value: rep.value, hidden: true }) : s.log };
    } else {
      const view: CueView = { value: rep.value, number: rep.number, side: last.side };
      s = {
        ...s,
        shownAtMs: s.cueAtMs,
        view,
        hideAtMs: s.cueAtMs + rep.displayMs,
        secondAtMs: rep.second ? s.cueAtMs + rep.second.delayMs : null,
        log: patchLast(s.log, { cueMs: s.cueAtMs, value: rep.value, number: rep.number }),
      };
      actions.push({ type: 'cueTone' });
    }
  }

  // Second cue (the defender recovers, or the free side changes).
  if (rep.second && s.secondAtMs !== null && now >= s.secondAtMs && !s.config.hidden) {
    s = {
      ...s,
      view: { value: rep.second.value, second: true },
      hideAtMs: s.secondAtMs + rep.displayMs,
      log: patchLast(s.log, { secondCueMs: s.secondAtMs, secondValue: rep.second.value }),
      secondAtMs: null,
    };
    actions.push({ type: 'cueTone' });
  }
  return { state: s, actions };
}

/** "cue 3 s" → [3, 3]; "cue 1-1.5 s random" → [1, 1.5]; a numeric benchmark cue level → that value. */
export function parseDisplayS(params: string | undefined, cueLevel: string | undefined, fallback: number | undefined): [number, number] {
  const m = /cue\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*s/i.exec(params ?? '');
  if (m) return [Number(m[1]), Number(m[2] ?? m[1])];
  if (cueLevel && /^\d+(\.\d+)?$/.test(cueLevel)) return [Number(cueLevel), Number(cueLevel)];
  const f = fallback ?? 1.5;
  return [f, f];
}
