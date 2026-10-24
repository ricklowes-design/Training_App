import { describe, expect, it } from 'vitest';
import { defenderReaction, judgeExit, MAX_COMMIT_SHARE, reactionProbabilities, type ArchetypeId, type ReactionInput } from './engine';

const base: ReactionInput = { feintFeatureEstimate: null, featureConfidence: 0, archetype: 'earlyCommit', difficulty: 2, recentPattern: [], randomSeed: 1 };
const share = (n: number, f: (i: number) => boolean) => Array.from({ length: n }, (_, i) => i).filter(f).length / n;

describe('DefenderReactionEngine (task 2.3)', () => {
  it('replays identically from the same seed', () => {
    for (let s = 0; s < 50; s++) expect(defenderReaction({ ...base, randomSeed: s })).toEqual(defenderReaction({ ...base, randomSeed: s }));
  });

  it('archetypes are visibly different in what they do', () => {
    const bites = (a: ArchetypeId) => share(2000, (i) => ['commit', 'commitThenRecover'].includes(defenderReaction({ ...base, archetype: a, randomSeed: i }).reaction));
    const holds = (a: ArchetypeId) => share(2000, (i) => defenderReaction({ ...base, archetype: a, randomSeed: i }).reaction === 'hold');
    const recovers = (a: ArchetypeId) => share(2000, (i) => defenderReaction({ ...base, archetype: a, randomSeed: i }).recovery);
    expect(bites('earlyCommit')).toBeGreaterThan(bites('holding') + 0.25);
    expect(holds('holding')).toBeGreaterThan(holds('earlyCommit') + 0.2);
    expect(recovers('reactive')).toBeGreaterThan(recovers('earlyCommit') + 0.2);
    // Early committers react sooner.
    const delay = (a: ArchetypeId) => Array.from({ length: 500 }, (_, i) => defenderReaction({ ...base, archetype: a, randomSeed: i }).responseDelayMs).reduce((x, y) => x + y) / 500;
    expect(delay('earlyCommit')).toBeLessThan(delay('holding'));
  });

  it('better validated execution raises the chance of a bite, but never to certainty', () => {
    const p = (q: number | null, c: number) => {
      const pr = reactionProbabilities({ ...base, feintFeatureEstimate: q, featureConfidence: c });
      return pr.commit + pr.commitThenRecover;
    };
    expect(p(0.95, 1)).toBeGreaterThan(p(0.5, 1));
    expect(p(0.1, 1)).toBeLessThan(p(0.5, 1));
    expect(p(1, 1)).toBeLessThanOrEqual(MAX_COMMIT_SHARE + 1e-9);
    // An untrusted estimate has no effect.
    expect(p(0.95, 0)).toBeCloseTo(p(null, 0));
    // A great feint can still meet a hold or a recovery.
    const strong = Array.from({ length: 500 }, (_, i) => defenderReaction({ ...base, feintFeatureEstimate: 1, featureConfidence: 1, randomSeed: i }).reaction);
    expect(strong.some((r) => r === 'hold' || r === 'commitThenRecover' || r === 'delay')).toBe(true);
  });

  it('a repeated fake direction is recognised: more holds', () => {
    const hold = (pattern: ('left' | 'right')[]) => reactionProbabilities({ ...base, recentPattern: pattern, difficulty: 4 }).hold;
    expect(hold(['left', 'left', 'left'])).toBeGreaterThan(hold(['left', 'right', 'left']));
  });

  it('reaction modes restrict the reactions while they are being learned', () => {
    const rs = Array.from({ length: 200 }, (_, i) => defenderReaction({ ...base, allowedModes: ['commitsToFeint'], randomSeed: i }).reaction);
    expect(new Set(rs)).toEqual(new Set(['commit']));
    const two = Array.from({ length: 400 }, (_, i) => defenderReaction({ ...base, allowedModes: ['commitsToFeint', 'holds'], randomSeed: i }).reaction);
    expect(new Set(two)).toEqual(new Set(['commit', 'hold']));
  });

  it('the correct exit follows the final relevant position', () => {
    for (let i = 0; i < 300; i++) {
      const o = defenderReaction({ ...base, archetype: 'reactive', feintDirection: 'left', randomSeed: i });
      if (o.reaction === 'commit') expect([o.commitDirection, o.correctExit]).toEqual(['left', 'right']);
      if (o.reaction === 'commitOpposite') expect([o.commitDirection, o.correctExit]).toEqual(['right', 'left']);
      if (o.reaction === 'commitThenRecover' || o.reaction === 'hold') expect(o.correctExit).toBe('protect');
    }
  });

  it('randomness never marks a wrong final decision correct', () => {
    for (let i = 0; i < 500; i++) {
      const o = defenderReaction({ ...base, archetype: (['earlyCommit', 'holding', 'reactive'] as const)[i % 3], randomSeed: i, feintFeatureEstimate: (i % 10) / 10, featureConfidence: 1 });
      const wrong = (['left', 'right', 'protect'] as const).filter((x) => x !== o.correctExit);
      for (const w of wrong) expect(judgeExit(w, o)).toBe(false);
      expect(judgeExit(o.correctExit, o)).toBe(true);
    }
  });

  it('the benchmark opponent never changes with difficulty-free inputs', () => {
    const a = reactionProbabilities({ ...base, archetype: 'benchmarkOpponent' });
    const b = reactionProbabilities({ ...base, archetype: 'benchmarkOpponent' });
    expect(a).toEqual(b);
  });
});

describe('adaptive defender (task 7.5)', () => {
  it('a habitual fake side is anticipated more often; the benchmark opponent never adapts', async () => {
    const { anticipation } = await import('./engine');
    const skew = { leftShare: 0.85, n: 20 };
    expect(reactionProbabilities({ ...base, tendency: skew }).commitOpposite).toBeGreaterThan(reactionProbabilities(base).commitOpposite);
    expect(anticipation({ archetype: 'benchmarkOpponent', tendency: skew })).toBe(0);
    expect(reactionProbabilities({ ...base, archetype: 'benchmarkOpponent', tendency: skew })).toEqual(reactionProbabilities({ ...base, archetype: 'benchmarkOpponent' }));
    expect(anticipation({ archetype: 'reactive', tendency: { leftShare: 0.9, n: 3 } })).toBe(0); // too few reps
    // Seeded and controlled: the same inputs replay identically.
    expect(defenderReaction({ ...base, tendency: skew, randomSeed: 5 })).toEqual(defenderReaction({ ...base, tendency: skew, randomSeed: 5 }));
  });
});
