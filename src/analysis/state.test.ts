import { describe, expect, it } from 'vitest';
import type { Clip } from '../db/types';
import { analysisState, analysisStateText } from './state';
import type { BlockAnalysis, RepAnalysis } from './types';

// Analysis states (Brief R07): pending is never a zero, failure says why.
const clip = (x: Partial<Clip> = {}) => ({ id: 'c', blob: new Blob(), mime: '', blockLabel: 'F5', sessionRecordId: 's', blockIndex: 1, attempt: 1, date: '', durationS: 60, startActiveMs: 0, ...x }) as Clip;
const block = (validReps: number) => ({ validReps }) as BlockAnalysis;
const rep = (status: RepAnalysis['status']) => ({ repIndex: 0, zoneEvents: [], confidence: 1, flags: [], status }) as RepAnalysis;

describe('analysis state', () => {
  it('no clip: not recorded; a clip with no analysis yet: pending', () => {
    expect(analysisState(undefined, undefined, [])).toBe('notRecorded');
    expect(analysisState(clip(), undefined, [])).toBe('pending');
    expect(analysisStateText('pending')).not.toMatch(/\b0\b/);
  });
  it('a failure is its own state, with the reason', () => {
    const c = clip({ analysis: { state: 'failed', reason: 'the pose model did not load', at: '' } });
    expect(analysisState(c, undefined, [])).toBe('failed');
    expect(analysisStateText('failed', c)).toContain('the pose model did not load');
  });
  it('analysed with no rep judged: unable to assess, not zero; otherwise ready', () => {
    expect(analysisState(clip(), block(0), [rep('unableToAssess')])).toBe('unableToAssess');
    expect(analysisStateText('unableToAssess')).toContain('not zero');
    expect(analysisState(clip(), block(3), [rep('ok')])).toBe('ready');
  });
  it('a replay-only clip says it has no scorecard', () => {
    expect(analysisState(clip({ analysis: { state: 'notAnalysed', at: '' } }), undefined, [])).toBe('notAnalysed');
  });
});
