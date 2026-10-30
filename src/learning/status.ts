import type { LearningExample, ModelVersion } from '../db/types';
import { MIN_TRAINING, MIN_VALIDATION } from './service';

// How far the head-turn personalisation is (owner request 2026-10-30): speech call-outs are needed only
// until the first personalised threshold has been tested; after that, right moves keep it learning.

/** Examples aimed for before a first threshold can be tested: training plus the held-out set (every third
 *  session is held out, so the held-out minimum is reached at about three times its size). */
export const CALIBRATION_TARGET = Math.max(30, MIN_TRAINING + MIN_VALIDATION);
/** Examples one calibration session is assumed to give before any has been done. */
export const DEFAULT_PER_SESSION = 10;

export interface ScanCalibration {
  /** A personalised threshold has been tested (used or not): speech is no longer needed. */
  established: boolean;
  examples: number;
  /** Average examples per session so far (or the default). */
  perSession: number;
  /** About how many more calibration sessions until the first test (0 once established). */
  sessionsLeft: number;
}

export function scanCalibration(examples: LearningExample[], versions: ModelVersion[]): ScanCalibration {
  const mine = examples.filter((e) => e.component === 'scanPattern' && e.verified);
  const established = versions.some((v) => v.component === 'scanPattern');
  const sessions = new Set(mine.map((e) => e.sessionRecordId ?? e.id)).size;
  const perSession = sessions ? Math.max(1, Math.round(mine.length / sessions)) : DEFAULT_PER_SESSION;
  const sessionsLeft = established ? 0 : Math.max(1, Math.ceil((CALIBRATION_TARGET - mine.length) / perSession));
  return { established, examples: mine.length, perSession, sessionsLeft };
}
