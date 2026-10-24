import type { DefenderDrill } from '../content/types';
import { rng } from '../cue/engine';
import type { DefenderScenario, Side } from '../db/types';
import { defenderReaction, type ArchetypeId } from './engine';
import { plannedTriggerMs, type DefenderMotion } from './stateMachine';

// A block with the 3D defender (task 2.4). Pure, like the cue engine: active block time
// comes in, the current rep and its scenario come out. The trigger is the moment the
// feint is taken as begun: planned timing (the defender has settled), a parent tap, or
// (slice 3) the camera's onset detector. The source is recorded on every rep.

export type TriggerMode = 'plannedTiming' | 'parentTrigger' | 'cameraOnset';

export interface DefenderBlockConfig {
  drill: DefenderDrill;
  reps: number | null;
  archetype: ArchetypeId;
  difficulty: number;
  allowedModes?: string[];
  /** Adaptive layer (task 7.5): habitual fake side from recent camera-seen reps; absent = no adaptation. */
  tendency?: { leftShare: number; n: number };
  /** Reaction-mode level from the progression, when the drill follows it. */
  modeLevel?: number;
  trigger: TriggerMode;
  view: 'player3d' | 'fallback2d';
  seed: number;
  rendererVersion: string;
}

export interface DefenderRepPlan {
  index: number;
  seed: number;
  approachMs: number;
  approachAngleDeg: number;
  approachSpeed: number;
  initialSide: Side | 'centre';
}

export interface DefenderBlockState {
  config: DefenderBlockConfig;
  plan: DefenderRepPlan[];
  repIdx: number;
  repStartMs: number | null;
  nextRepMs: number;
  /** Rep-relative ms of the trigger, once known. */
  triggerRel: number | null;
  motion: DefenderMotion | null;
  scenarios: DefenderScenario[];
  done: boolean;
}

export interface DefenderInput {
  /** Active ms of the latest parent/player tap or camera onset. */
  triggerAtMs?: number;
  /** Camera estimate of the feint (slice 3): direction, quality 0..1 and confidence. */
  feint?: { direction?: Side; quality: number | null; confidence: number };
}

export type DefenderAction = { type: 'repTone' };

/** A trigger that never comes falls back to planned timing after this long (labelled). */
export const TRIGGER_TIMEOUT_MS = 3000;

/** Approach variety: angle, speed and start side drawn from the seed, balanced over the block. */
export function planDefenderReps(c: DefenderBlockConfig): DefenderRepPlan[] {
  const r = rng(c.seed);
  const n = c.reps ?? 200;
  const sides: (Side | 'centre')[] = ['left', 'centre', 'right'];
  return Array.from({ length: n }, (_, index) => {
    const approachSpeed = 0.8 + 0.6 * r(); // relative, within readable bounds
    const ms = 1000 * (c.drill.approachMinS + (c.drill.approachMaxS - c.drill.approachMinS) * r());
    return {
      index,
      seed: Math.floor(r() * 2 ** 31),
      approachMs: Math.round(ms / approachSpeed),
      approachAngleDeg: Math.round((2 * r() - 1) * c.drill.approachAngleMaxDeg),
      approachSpeed: Math.round(approachSpeed * 100) / 100,
      initialSide: sides[Math.floor(r() * 3)],
    };
  });
}

export function initDefenderBlock(config: DefenderBlockConfig): DefenderBlockState {
  return { config, plan: planDefenderReps(config), repIdx: -1, repStartMs: null, nextRepMs: 0, triggerRel: null, motion: null, scenarios: [], done: false };
}

const recentFakes = (s: DefenderBlockState): Side[] => s.scenarios.map((x) => x.feintDirection).filter((x): x is Side => !!x);

export function tickDefenderBlock(s: DefenderBlockState, now: number, input: DefenderInput = {}): { state: DefenderBlockState; actions: DefenderAction[] } {
  if (s.done) return { state: s, actions: [] };
  const actions: DefenderAction[] = [];
  const periodMs = 1000 * s.config.drill.repPeriodS;
  if (now >= s.nextRepMs) {
    const idx = s.repIdx + 1;
    if (s.config.reps !== null && idx >= s.config.reps) return { state: { ...s, done: true }, actions };
    actions.push({ type: 'repTone' });
    s = { ...s, repIdx: idx, repStartMs: now, nextRepMs: now + periodMs, triggerRel: null, motion: null };
  }
  const rep = s.plan[s.repIdx % s.plan.length];
  if (s.repStartMs === null || !rep || s.motion) return { state: s, actions };

  // Waiting for the trigger.
  const rel = now - s.repStartMs;
  const planned = plannedTriggerMs(rep);
  let triggerRel: number | null = null;
  let source: DefenderScenario['triggerSource'] = 'plannedTiming';
  if (s.config.trigger === 'plannedTiming') {
    if (rel >= planned) triggerRel = planned;
  } else {
    const tapRel = input.triggerAtMs !== undefined ? input.triggerAtMs - s.repStartMs : undefined;
    if (tapRel !== undefined && tapRel >= rep.approachMs * 0.6) {
      triggerRel = Math.max(tapRel, rep.approachMs);
      source = s.config.trigger === 'cameraOnset' ? 'cameraOnset' : 'parentTrigger';
    } else if (rel >= planned + TRIGGER_TIMEOUT_MS) {
      triggerRel = planned + TRIGGER_TIMEOUT_MS; // fallback, recorded as planned timing
    }
  }
  if (triggerRel === null) return { state: s, actions };

  const feint = source === 'cameraOnset' ? input.feint : undefined;
  const out = defenderReaction({
    feintFeatureEstimate: feint?.quality ?? null,
    featureConfidence: feint?.confidence ?? 0,
    archetype: s.config.archetype,
    difficulty: s.config.difficulty,
    recentPattern: recentFakes(s),
    feintDirection: feint?.direction,
    randomSeed: rep.seed,
    allowedModes: s.config.allowedModes,
    tendency: s.config.tendency,
  });
  const motion: DefenderMotion = {
    approachMs: rep.approachMs,
    approachAngleDeg: rep.approachAngleDeg,
    initialSide: rep.initialSide,
    reaction: out.reaction,
    commitDirection: out.commitDirection,
    strength: out.strength,
    reactionDelayMs: out.responseDelayMs,
    recovery: out.recovery,
  };
  const t0 = s.repStartMs;
  const scenario: DefenderScenario & { feintDirection?: Side } = {
    id: `${s.config.seed}-${rep.index}`,
    repIndex: rep.index,
    view: s.config.view,
    archetype: s.config.archetype,
    difficulty: s.config.difficulty,
    reactionSeed: rep.seed,
    approachAngleDeg: rep.approachAngleDeg,
    approachSpeed: rep.approachSpeed,
    approachMs: rep.approachMs,
    initialSide: rep.initialSide,
    reaction: out.reaction,
    commitDirection: out.commitDirection,
    strength: out.strength,
    reactionDelayMs: out.responseDelayMs,
    recovery: out.recovery,
    cueEvents: [
      { state: 'repStart', atMs: t0 },
      { state: 'trigger', atMs: t0 + triggerRel },
      { state: 'reaction', atMs: t0 + triggerRel + out.responseDelayMs },
    ],
    triggerSource: source,
    rendererVersion: s.config.rendererVersion,
    correctExit: out.correctExit,
    parametersVersion: out.parametersVersion,
    feintDirection: feint?.direction,
  };
  return { state: { ...s, triggerRel, motion, scenarios: [...s.scenarios, scenario] }, actions };
}
