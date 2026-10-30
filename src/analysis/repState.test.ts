import { describe, expect, it } from 'vitest';
import { repState } from './Scorecard';
import type { RepAnalysis } from './types';

// Rep states carry a symbol and words, not only a colour (Brief R15).
const rep = (x: Partial<RepAnalysis>): RepAnalysis => ({ repIndex: 0, zoneEvents: [], confidence: 1, flags: [], status: 'ok', ...x });

describe('rep strip states', () => {
  it('each state has its own symbol and text', () => {
    const states = [rep({ decisionCorrect: true }), rep({ decisionCorrect: false }), rep({ decisionCorrect: true, possibleEarlyRouteCommitment: 'x' }), rep({ status: 'unableToAssess' }), rep({})].map(repState);
    expect(states.map((s) => s.text)).toEqual(['right way', 'wrong way', 'possibly early', 'unable to assess', 'not judged']);
    expect(new Set(states.map((s) => s.symbol)).size).toBe(5);
  });
  it('unable to assess is never shown as a wrong or zero rep', () => {
    expect(repState(rep({ status: 'unableToAssess', decisionCorrect: false })).text).toBe('unable to assess');
  });
});
