import { describe, expect, it } from 'vitest';
import type { RepAnalysis } from '../analysis/types';
import { callOutsPerRep } from '../audio/speechDigits';
import type { CueLogEntry } from '../cue/engine';
import { outcomeExamples, type OutcomeInput } from './outcomes';

// Head-turn labels from what the player did (owner decision 2026-10-30).
const log = (n: number, extra: Partial<CueLogEntry> = {}): CueLogEntry[] =>
  Array.from({ length: n }, (_, i) => ({ rep: i, repStartMs: i * 5000, trigger: 'timed' as const, cueMs: i * 5000 + 1000, value: 'LEFT FREE', plannedDelayMs: 1000, ...extra }));
const rep = (i: number, correct: boolean, turn: number): RepAnalysis => ({ repIndex: i, zoneEvents: [], confidence: 0.9, flags: [], status: 'ok', decisionCorrect: correct, maxHeadTurn: turn });
const input = (reps: RepAnalysis[], x: Partial<OutcomeInput> = {}): OutcomeInput => ({ clipId: 'c', sessionRecordId: 's', date: '2026-11-04', cueValues: 3, log: log(reps.length), reps, reviewed: new Set(), ...x });

describe('head-turn labels from what the player did', () => {
  it('right and wrong moves label looks, from a block well above guessing', () => {
    const reps = [...Array.from({ length: 8 }, (_, i) => rep(i, true, 0.3)), rep(8, false, 0.05), rep(9, false, 0.1)];
    const ex = outcomeExamples(input(reps));
    expect(ex).toHaveLength(10);
    expect(ex.filter((e) => e.label === 'yes').every((e) => e.features.headTurn === 0.3 && e.labelSource === 'taskOutcome')).toBe(true);
    expect(ex.filter((e) => e.label === 'no').map((e) => e.features.headTurn)).toEqual([0.05, 0.1]);
  });
  it('a block near guessing level teaches nothing from its moves', () => {
    const reps = Array.from({ length: 9 }, (_, i) => rep(i, i < 4, 0.2)); // 4/9 right, guessing is 1/3
    expect(outcomeExamples(input(reps))).toEqual([]);
  });
  it('a right call-out confirms a look even in a weak block; a wrong or misheard one is left out', () => {
    const reps = Array.from({ length: 6 }, (_, i) => rep(i, false, 0.22));
    const callOuts = [
      { rep: 0, shown: 7, heard: 7 },
      { rep: 1, shown: 3, heard: 8 },
      { rep: 2, shown: 5 },
    ];
    const ex = outcomeExamples(input(reps, { callOuts }));
    expect(ex.map((e) => [e.id, e.label, e.labelSource])).toEqual([['c:0:outcome', 'yes', 'callOut']]);
  });
  it("a parent's review of a rep wins, and catch trials are left out", () => {
    const reps = Array.from({ length: 10 }, (_, i) => rep(i, true, 0.3));
    const l = log(10);
    l[3] = { ...l[3], hidden: true };
    const ex = outcomeExamples(input(reps, { log: l, reviewed: new Set([0]) }));
    expect(ex.map((e) => e.id)).not.toContain('c:0:outcome');
    expect(ex.map((e) => e.id)).not.toContain('c:3:outcome');
    expect(ex).toHaveLength(8);
  });
  it('call-outs per rep: the first number heard in the window after the cue', () => {
    const l = log(3).map((e, i) => ({ ...e, number: [4, 6, 9][i] }));
    const heard = [{ tMs: 1500, digit: 4 }, { tMs: 6500, digit: 2 }];
    expect(callOutsPerRep(l, heard)).toEqual([{ rep: 0, shown: 4, heard: 4 }, { rep: 1, shown: 6, heard: 2 }, { rep: 2, shown: 9, heard: undefined }]);
  });
});

describe('learning from these labels (simulated player)', () => {
  it("a player with small real shoulder checks gets a lower look threshold, used only because it does better on held-out sessions", async () => {
    const { freezeValidation, proposeCandidate } = await import('./service');
    const { SCAN_BASE } = await import('./harvest');
    // 12 sessions of 10 reps; the player looks on 80% of reps with a small turn (0.18–0.30), else barely
    // turns (0.02–0.10). Without a look a decision is a guess (1 in 3).
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const examples = [];
    for (let s = 0; s < 12; s++) {
      const reps = Array.from({ length: 10 }, (_, i) => {
        const looked = rnd() < 0.8;
        const turn = looked ? 0.18 + rnd() * 0.12 : 0.02 + rnd() * 0.08;
        const correct = looked ? rnd() < 0.95 : rnd() < 1 / 3;
        return rep(i, correct, Math.round(turn * 100) / 100);
      });
      examples.push(...outcomeExamples(input(reps, { clipId: `clip${s}`, sessionRecordId: `s${s}`, date: `2026-11-${String(s + 1).padStart(2, '0')}` })));
    }
    const val = freezeValidation(examples, 'scanPattern', '2026-12-01')!;
    const r = proposeCandidate({ component: 'scanPattern', feature: 'headTurn', base: SCAN_BASE, examples, validation: val, versions: [], now: '2026-12-01' })!;
    expect(r.candidate.status).toBe('active');
    expect(r.candidate.params.threshold).toBeGreaterThan(0.08);
    expect(r.candidate.params.threshold).toBeLessThanOrEqual(0.2);
  });
});
