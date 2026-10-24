import { rng } from '../cue/engine';
import type { DefenderReaction, Side } from '../db/types';

// DefenderReactionEngine (task 2.3, part 16 §3, part 15 D4). Pure and seeded: the same
// inputs and seed always give the same reaction, so scenarios replay identically.
//
// The probability tables below are GAME-DESIGN PARAMETERS. They are illustrative and
// tunable, not empirical models of real defenders, and must never be described as such.

export const PARAMETERS_VERSION = 'gd-1';

export type ArchetypeId = 'earlyCommit' | 'holding' | 'reactive' | 'benchmarkOpponent';

export const REACTIONS: DefenderReaction[] = ['commit', 'hold', 'delay', 'commitOpposite', 'commitThenRecover'];

/** Base reaction probabilities per archetype (game-design parameters, illustrative). */
export const ARCHETYPE_TABLE: Record<ArchetypeId, Record<DefenderReaction, number>> = {
  earlyCommit: { commit: 0.55, hold: 0.12, delay: 0.1, commitOpposite: 0.1, commitThenRecover: 0.13 },
  holding: { commit: 0.2, hold: 0.42, delay: 0.18, commitOpposite: 0.1, commitThenRecover: 0.1 },
  reactive: { commit: 0.22, hold: 0.13, delay: 0.15, commitOpposite: 0.08, commitThenRecover: 0.42 },
  // Fixed and non-learning: used for assessments so results stay comparable (part 18).
  benchmarkOpponent: { commit: 0.35, hold: 0.25, delay: 0.15, commitOpposite: 0.1, commitThenRecover: 0.15 },
};

/** Base response delay (ms) per archetype, before difficulty; game-design parameters. */
export const ARCHETYPE_DELAY_MS: Record<ArchetypeId, [number, number]> = {
  earlyCommit: [120, 260],
  holding: [300, 520],
  reactive: [200, 380],
  benchmarkOpponent: [220, 400],
};

/** Reaction-mode progression (content `reactionModesProgression`) → the reactions each level allows. */
export const MODE_REACTIONS: Record<string, DefenderReaction[]> = {
  commitsToFeint: ['commit'],
  holds: ['hold'],
  delays: ['delay'],
  commitsOpposite: ['commitOpposite'],
  commitsThenRecovers: ['commitThenRecover'],
  noSecondCue: [],
  mixedCatchTrials: [],
};

/** How strongly execution quality moves the chance of a commitment (game-design parameter). */
export const QUALITY_GAIN = 1.2;
/** A commitment is never certain, however good the feint (part 16 §3). */
export const MAX_COMMIT_SHARE = 0.85;

export interface ReactionInput {
  /** Estimated execution quality of the feint, 0..1, or null when nothing was observed. */
  feintFeatureEstimate: number | null;
  /** Confidence in that estimate, 0..1. Low confidence pulls the estimate to neutral. */
  featureConfidence: number;
  archetype: ArchetypeId;
  /** 1 (easy) .. 5 (hard). */
  difficulty: number;
  /** The player's recent fake directions, most recent last. */
  recentPattern: Side[];
  /** Direction of the fake when known (camera); otherwise the commitment side is drawn at random. */
  feintDirection?: Side;
  randomSeed: number;
  /** Reaction modes unlocked so far (from the progression); empty = all. */
  allowedModes?: string[];
  /** Adaptive layer (part 18, task 7.5): the player's habitual fake side over recent camera-seen reps. Ignored by the benchmark opponent. */
  tendency?: { leftShare: number; n: number };
}

export interface ReactionOutput {
  reaction: DefenderReaction;
  /** Side the defender steps to (the side it bites on); absent for hold. */
  commitDirection?: Side;
  /** 0..1 size of the lateral step. */
  strength: number;
  responseDelayMs: number;
  recovery: boolean;
  /** The action that is correct against the defender's FINAL relevant position. */
  correctExit: Side | 'protect';
  probabilities: Record<DefenderReaction, number>;
  parametersVersion: string;
}

const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');

/** The reaction distribution after quality, pattern recognition, difficulty and allowed modes. */
/** How strongly a habit is anticipated, 0..1: zero for the fixed benchmark opponent or too little data. */
export function anticipation(input: Pick<ReactionInput, 'archetype' | 'tendency'>): number {
  const t = input.tendency;
  if (input.archetype === 'benchmarkOpponent' || !t || t.n < 8) return 0;
  return Math.min(1, Math.max(0, (Math.abs(t.leftShare - 0.5) - 0.1) * 2.5));
}

export function reactionProbabilities(input: Omit<ReactionInput, 'randomSeed' | 'feintDirection'>): Record<DefenderReaction, number> {
  const base = { ...ARCHETYPE_TABLE[input.archetype] };
  // A habit is read: more early steps into her usual exit (controlled; never certain).
  base.commitOpposite *= 1 + 2.5 * anticipation(input);
  // Quality only counts as far as it is trusted: unknown or low-confidence → neutral 0.5.
  const c = Math.max(0, Math.min(1, input.featureConfidence));
  const q = input.feintFeatureEstimate === null ? 0.5 : 0.5 + (Math.max(0, Math.min(1, input.feintFeatureEstimate)) - 0.5) * c;
  const k = 1 - QUALITY_GAIN / 2 + QUALITY_GAIN * q; // 0.4 at q=0, 1 at q=0.5, 1.6 at q=1
  base.commit *= k;
  base.commitThenRecover *= k;
  // A repeated move is recognised: three fakes the same way make the defender more likely to hold.
  const recent = input.recentPattern.slice(-3);
  if (recent.length === 3 && recent.every((s) => s === recent[0])) base.hold *= 1 + 0.25 * input.difficulty;
  // Harder defenders recover more.
  base.commitThenRecover *= 1 + 0.1 * (input.difficulty - 1);
  let allowed = REACTIONS;
  if (input.allowedModes?.length) {
    const fromModes = new Set(input.allowedModes.flatMap((m) => MODE_REACTIONS[m] ?? []));
    if (fromModes.size) allowed = REACTIONS.filter((r) => fromModes.has(r));
  }
  for (const r of REACTIONS) if (!allowed.includes(r)) base[r] = 0;
  let total = REACTIONS.reduce((t, r) => t + base[r], 0);
  if (total <= 0) return { commit: 0, hold: 1, delay: 0, commitOpposite: 0, commitThenRecover: 0 };
  const out = Object.fromEntries(REACTIONS.map((r) => [r, base[r] / total])) as Record<DefenderReaction, number>;
  // Cap the bite: a great feint never guarantees a commitment.
  const biteShare = out.commit + out.commitThenRecover;
  const others = 1 - biteShare;
  if (biteShare > MAX_COMMIT_SHARE && others > 0) {
    const scale = MAX_COMMIT_SHARE / biteShare;
    const lift = (1 - MAX_COMMIT_SHARE) / others;
    for (const r of REACTIONS) out[r] *= r === 'commit' || r === 'commitThenRecover' ? scale : lift;
  }
  total = REACTIONS.reduce((t, r) => t + out[r], 0);
  for (const r of REACTIONS) out[r] /= total;
  return out;
}

export function defenderReaction(input: ReactionInput): ReactionOutput {
  const r = rng(input.randomSeed);
  const probabilities = reactionProbabilities(input);
  let x = r();
  let reaction: DefenderReaction = 'hold';
  for (const re of REACTIONS) {
    if (x < probabilities[re]) {
      reaction = re;
      break;
    }
    x -= probabilities[re];
  }
  const sideDraw: Side = r() < 0.5 ? 'left' : 'right';
  const fake = input.feintDirection;
  const [d0, d1] = ARCHETYPE_DELAY_MS[input.archetype];
  const hard = 1 - 0.08 * (input.difficulty - 1); // harder = quicker
  const responseDelayMs = Math.round((d0 + (d1 - d0) * r()) * hard);
  const q = input.feintFeatureEstimate ?? 0.5;
  const strength = Math.round(100 * Math.min(1, 0.45 + 0.35 * r() + 0.2 * (q - 0.5) * input.featureConfidence)) / 100;
  let commitDirection: Side | undefined;
  switch (reaction) {
    case 'commit':
    case 'commitThenRecover':
      commitDirection = fake ?? sideDraw; // bites on the fake
      break;
    case 'commitOpposite': {
      // Read the fake and stepped into her exit; with no camera, an anticipating defender steps into her usual exit.
      const habit = input.tendency && anticipation(input) > 0 ? (input.tendency.leftShare > 0.5 ? 'left' : 'right') : undefined;
      commitDirection = fake ? other(fake) : habit ? other(habit) : sideDraw;
      break;
    }
    case 'delay':
      commitDirection = fake ?? sideDraw; // late step, toward the fake
      break;
    case 'hold':
      commitDirection = undefined;
  }
  const recovery = reaction === 'commitThenRecover';
  // Validated against the final relevant position: a recovered or holding defender is in front again.
  const correctExit: Side | 'protect' = reaction === 'hold' || recovery ? 'protect' : other(commitDirection!);
  return { reaction, commitDirection, strength, responseDelayMs, recovery, correctExit, probabilities, parametersVersion: PARAMETERS_VERSION };
}

/** Whether a physical action was right. Randomness never turns a wrong final decision into a correct one. */
export function judgeExit(selected: Side | 'protect' | undefined, out: Pick<ReactionOutput, 'correctExit'>): boolean | undefined {
  if (selected === undefined) return undefined;
  return selected === out.correctExit;
}
