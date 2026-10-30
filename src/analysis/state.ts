import type { BlockAnalysis, RepAnalysis } from './types';
import type { Clip } from '../db/types';

// What the camera analysis of one block can say right now (Brief R07). Pending is never shown as a zero,
// a failure says why, and a block with no clip says it was not recorded.

export type AnalysisState = 'notRecorded' | 'pending' | 'notAnalysed' | 'failed' | 'unableToAssess' | 'ready';

export function analysisState(clip: Clip | undefined, a: BlockAnalysis | undefined, reps: RepAnalysis[]): AnalysisState {
  if (!clip) return 'notRecorded';
  if (a) {
    const assessed = reps.some((r) => r.status !== 'unableToAssess') || !!a.slalom?.some((s) => s.status === 'estimate') || !!a.vPulls?.length || !!a.taps?.length;
    return assessed || a.validReps > 0 ? 'ready' : 'unableToAssess';
  }
  if (clip.analysis?.state === 'failed') return 'failed';
  if (clip.analysis?.state === 'notAnalysed') return 'notAnalysed';
  return 'pending';
}

export function analysisStateText(st: AnalysisState, clip?: Clip): string | null {
  switch (st) {
    case 'notRecorded':
      return null;
    case 'pending':
      return 'Recorded. The camera scorecard appears here when the analysis finishes; nothing needs to wait for it.';
    case 'notAnalysed':
      return 'Recorded for replay. This drill has no camera scorecard.';
    case 'failed':
      return `Recorded, but the camera analysis could not finish${clip?.analysis?.reason ? ` (${clip.analysis.reason})` : ''}. The clip is kept; the result card is unchanged.`;
    case 'unableToAssess':
      return 'Analysed: the camera could not judge any rep in this block (unable to assess, not zero). Check the framing and the drill area in the camera set-up.';
    case 'ready':
      return null;
  }
}
