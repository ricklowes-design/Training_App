// Per-rep and per-block results of the camera analysis (plan/08 §8.3, plan/12).

export interface ZoneEvent {
  zone: string;
  tMs: number; // active block time
}

export interface RepAnalysis {
  repIndex: number;
  cueTimeMs?: number;
  cueValue?: string;
  catchType?: string;
  onsetMs?: number; // reaction onset (first motion after the cue)
  exitMs?: number;
  exitDir?: 'left' | 'right';
  decisionCorrect?: boolean;
  headUpAtExit?: boolean;
  looksBeforeTouch?: number;
  /** Largest held head turn before the touch (shoulder widths), the scanning model's feature. */
  maxHeadTurn?: number;
  lastLookToTouchMs?: number;
  touchMs?: number;
  zoneEvents: ZoneEvent[];
  /** Defender reps (part 16 §4): what the defender did, and the technique/timing evidence. */
  defenderReaction?: string;
  techniqueStatus?: 'observedExecution' | 'estimatedTechnique' | 'unableToAssess';
  fakeShiftHipWidths?: number;
  exitShiftHipWidths?: number;
  /** Only with evidence: the final exit movement began before the defender's move could be seen. */
  possibleEarlyRouteCommitment?: string;
  /** Movement before the defender information: legitimate (the fake), recorded separately. */
  preCueMovement?: boolean;
  timingUncertaintyMs?: number;
  confidence: number; // 0..1
  flags: string[];
  status: 'ok' | 'unableToAssess';
}

export interface BlockAnalysis {
  reps: number;
  validReps: number;
  accuracy?: number; // 0..1 over valid reps with a decision
  accuracyByCue: Record<string, { correct: number; of: number }>;
  /** Legacy (< 200 ms rule, replaced by part 15 D6); kept in old analyses, not computed. */
  preCommitRate?: number;
  /** Defender blocks (part 16 §4). */
  correctByDefenderAction?: Record<string, { correct: number; of: number }>;
  changeOfMind?: { correct: number; of: number };
  possibleEarlyRouteCommitments?: number;
  medianTimeToExitMs?: number;
  timingUncertaintyMs?: number;
  technique?: { observedExecution: number; estimatedTechnique: number; unableToAssess: number };
  medianDeceptionRatio?: number;
  ranIntoDefenderRate?: number;
  waitedRate?: number;
  reactivitySlope?: number;
  reactivityBand?: [number, number];
  /** Median cue-to-exit time on reactive reps ÷ on simple reps, same block (relative timing only). */
  exitTimeReactiveVsSimple?: number;
  headUpRate?: number;
  looksBeforeTouchRate?: number;
  medianLastLookToTouchMs?: number;
  flaggedRepIndexes: number[];
  /** Personalised model versions this analysis used (part 18); absent = base rules only. History is never re-scored. */
  modelVersions?: string[];
  /** Slalom runs (plan/12 §12.3): start tone → stop zone, lane-edge entries. Estimates. */
  slalom?: import('./outcome').SlalomRun[];
  /** V-pull windows: ball direction reversals in the square and balls lost from it. Estimates. */
  vPulls?: import('./outcome').VPullWindow[];
  /** Experimental rapid-touch estimates (task 6.7), never progression-eligible. */
  taps?: import('./outcome').TapWindow[];
  /** Ball tracking summary (part 17), an estimate until validated; never progression-eligible before then. */
  ball?: import('../ball/summary').BallSummary;
  enoughReps: boolean; // ≥ 8 valid reps
  poseUsed: boolean;
  analysedFps: number;
  analysisMs: number;
}
