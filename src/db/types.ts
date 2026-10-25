// Records stored on the device (IndexedDB via Dexie). See plan/08 §8.3.

export type SessionStatus = 'completed' | 'completedBenchmarkSkipped' | 'partial' | 'stopped';

/** programme: a numbered session in an area. baseline: an area's placement session.
 *  extra: a repeat of a completed session or the no-ball quiz. anchor: the fortnightly anchor check. */
export type RecordKind = 'programme' | 'baseline' | 'extra' | 'anchor';

export type Foot = 'left' | 'right';

export interface Player {
  id: 'main';
  name: string;
  dominantFoot: Foot;
  position: string;
}

export interface DerivedLayout {
  slalomCones?: number;
  feintStartM?: number;
  slalomSpacingM: number;
  slalomFirstConeM: number;
  slalomStopZoneM: number;
  feintConeM: number;
  feintGateAtM: number;
  feintGateWidthM: number;
  feintStopZoneM: number;
  /** False when there are too few cones for a start cone: the run starts from the back wall. Absent = true. */
  feintStartCone?: boolean;
  receiveBoxSideM: number;
  receiveGateWidthM: number;
  masterySquareM: number;
}

export interface RoomLayout {
  version: number;
  createdAt: string;
  roomLengthM: number;
  roomWidthM: number;
  floor: 'hard' | 'carpet' | 'rubber';
  wallUsable: boolean;
  cones: number;
  derived: DerivedLayout;
  /** Schema 3: the room profile this geometry was derived from. */
  roomProfileId?: string;
  roomProfileVersion?: number;
  usableSpaceClass?: UsableSpaceClass;
}

export interface SoundSettings {
  tones: boolean;
  speech: boolean;
  endOfSessionLine: boolean;
  volume: number; // 0..1
  voiceRate: number; // 0.5..1.5
  voiceURI?: string;
}

export interface Settings {
  id: 'main';
  firstRunDone: boolean;
  weekStartDay: number; // 0 = Sunday, 1 = Monday
  weeklyTarget: number;
  practiceDays: number[];
  pinHash?: string;
  sound: SoundSettings;
  milestoneCards: boolean;
  weeklySummary: boolean;
  backupReminder: boolean;
  lastBackupAt?: string;
  equipment: { cones: number; sparePhone: boolean; tripod: boolean };
  /** How lengths are shown and entered; always stored in metres. Absent = metric. */
  units?: 'metric' | 'imperial';
  priorities: string[];
  partnerAvailable: boolean;
  trialUntil?: string; // ISO date; all sessions are trials until then
  lastSeenAppVersion?: string;
  lastSeenContentVersion?: string;
  demoChoice: Record<string, 'outside' | 'own'>;
  cardAutoAdvanceS: number;
  demoAutoStartS: number;
  persistGranted?: boolean;
  cueEngine: boolean;
  camera: CameraSettings;
  flags: FeatureFlags;
  capabilities?: Capabilities;
  /** Parent validation of camera measures against a blind frame reading (plan/10), per component. */
  validations?: Record<string, { date: string; reps: number; agreed: number; falsePositives?: number; note?: string }>;
  /** Task 3.1: measured before any millisecond threshold is set. */
  timingBudget?: TimingBudget;
  /** Room profile used for sessions (part 15 D1). */
  activeRoomProfileId?: string;
  activeBallProfileId?: string;
  /** Weekly availability: days with a game or team practice (no heavy sessions). */
  gameDays: number[];
  /** Weekly allocation per area (relative weight, 1 = equal share). Absent = all equal. */
  allocation?: Record<string, number>;
  /** Completion messages to a chat webhook (plan/14), when the Notifications feature is on. */
  notify?: {
    channel: 'discord' | 'telegram';
    webhookUrl?: string;
    telegramToken?: string;
    telegramChatId?: string;
    /** Optional first name for the greeting (the only personal detail sent). */
    firstName?: string;
    pausedUntil?: string;
    pauseReason?: string;
    queue?: import('../app/notify').QueuedMessage[];
  };
  /** Dates marked in the availability calendar (YYYY-MM-DD): a rest day, a light day or a game. */
  availability?: { date: string; kind: 'rest' | 'light' | 'game' }[];
}

export interface CameraSettings {
  enabled: boolean;
  deviceId?: string;
  retentionDays: number;
  /** Set from the pose speed test (task 14): which model the after-block analysis uses, and at what frame rate. */
  pose: 'off' | 'lite' | 'full';
  analysisFps: number;
  poseTest?: { date: string; liteFps?: number; fullFps?: number; delegate: string; frames: number; source: string };
}

export interface Pause {
  startMs: number;
  endMs: number;
}

export type RunBlockKind =
  | 'warmup'
  | 'work'
  | 'rest'
  | 'benchmark'
  | 'log'
  | 'transition'
  | 'cooldown'
  | 'mobility'
  | 'break'
  | 'anchor'
  | 'quiz';

export interface BlockResult {
  /** Timed stretches inside the block on its active clock (slalom runs, V-pull windows), for the camera. */
  windows?: { label: string; startMs: number; endMs?: number }[];
  index: number; // index in the run plan
  kind: RunBlockKind;
  attempt: number; // 1 for the first run of a block, 2 for a Repeat, …
  drillId?: string;
  benchmarkId?: string;
  anchorId?: string;
  areaId?: string;
  plannedS: number;
  elapsedS: number; // active time, pauses excluded
  ranToEnd: boolean;
  doneEarly: boolean; // DONE pressed before the timer ended
  skipped: boolean;
  mode: 'timed' | 'reps';
  note?: string;
  keptAt?: string; // per-drill "Keep this" on a trial
  cueLog?: import('../cue/engine').CueLogEntry[];
  cueLevel?: string; // engine-timed / engine-tripwire when the cue engine ran the block
  presenceFrac?: number; // camera presence in the drill area (plan/14 §14.6 item 4)
  clipId?: string;
  /** A block run with the defender (part 15 D3): the view actually used and how reps were triggered. */
  defender?: { view: 'player3d' | 'fallback2d'; archetype: string; reps: number; triggerSources: string[]; fallbackReason?: string; scenarioIds: string[] };
}

export interface SessionRecord {
  id: string;
  runId: string;
  kind: RecordKind;
  areaId?: string;
  sessionNumber?: number;
  sessionId?: string;
  date: string; // ISO timestamp of the start
  endedAt?: string;
  status: SessionStatus;
  reasons: string[];
  plannedMinutes: number;
  blocks: BlockResult[];
  pauses: Pause[];
  trial: boolean;
  promotedAt?: string;
  demotedAt?: string;
  demoteReason?: string;
  unlockRetained?: boolean; // demoted, but a later record depended on its unlock
  light?: boolean;
  partner?: boolean;
  appVersion: string;
  contentVersion: string;
  layoutVersion: number;
  cameraSetupVersion?: number;
  baselineAnswers?: boolean[];
  /** Schema 3: the room profile in use and the session-launch room check (task 1.3). */
  roomProfileId?: string;
  roomProfileVersion?: number;
  roomCheck?: { status: 'matched' | 'partial' | 'moved' | 'unusable' | 'noPhoto'; matched: number; total: number };
}

export interface Conditions {
  layoutVersion: number;
  cueLevel: string;
  floor: string;
  recorded: boolean;
  recordedBy: 'parent' | 'self' | 'app';
  timing?: 'tap' | 'parent';
  /** Extended context key (part 15 D11). Absent on results from before the plan update. */
  roomProfileVersion?: string;
  defenderArchetype?: string;
  taskMode?: string;
  cameraConfidence?: 'none' | 'low' | 'ok';
  ballProfileId?: string;
  modelVersion?: string;
}

/** Values per benchmark type. */
export type BenchmarkValues =
  | { kind: 'SB'; correct: number; scans?: number }
  | { kind: 'FB'; left: { sell: number; exit: number; eyes: number }; right: { sell: number; exit: number; eyes: number } }
  | { kind: 'DB'; right: { timeS: number; errors: number; digits?: number }; left: { timeS: number; errors: number; digits?: number } }
  | { kind: 'CB'; cb1: { left: number; right: number }; cb2: { left: number; right: number } }
  | { kind: 'CA'; correct: number; outOf: number }
  | { kind: 'A1'; right: { timeS: number; errors: number }; left: { timeS: number; errors: number } }
  | { kind: 'A2'; left: number; right: number }
  | { kind: 'A3'; correct: number; early: number; /** Legacy (hip-width speed, removed by part 15 D2); kept in old records, never shown. */ speedHeldPct?: number }
  | { kind: 'A4'; correct: number; looks?: number }
  | { kind: 'QUIZ'; correct: number; outOf: number };

export interface BenchmarkResult {
  /** The confirmed numbers started from this block's camera estimate (D10). */
  prefilledFrom?: 'camera';
  id: string;
  sessionRecordId: string;
  blockIndex: number;
  attempt: number;
  date: string;
  benchmarkId: string; // SB FB DB CB CA or an anchor id A1–A4
  areaId?: string;
  drillId?: string;
  conditions: Conditions;
  values: BenchmarkValues;
  keptAt?: string;
  flagged?: string; // "unreliable" note, e.g. start tone missed
}

export interface Placement {
  areaId: string;
  startSession: number;
  proposed: number;
  overridden: boolean;
  explanation: string;
  date: string;
  baselineRecordId?: string;
}

export type OverrideTarget = { kind: 'drill'; id: string } | { kind: 'session'; id: string };

export interface Override {
  id?: number;
  date: string;
  author: string;
  target: OverrideTarget;
  field: string; // e.g. 'cues', 'prescription', 'blocks', 'demo'
  value: unknown;
  previousValue: unknown;
  revertedAt?: string;
}

export interface CustomDrill {
  id: string;
  date: string;
  author: string;
  drill: import('../content/types').Drill;
}

export type NoteTarget = { kind: 'drill' | 'session' | 'area' | 'clip'; id: string };

export interface CoachNote {
  id?: number;
  date: string;
  author: string;
  target: NoteTarget;
  body: string;
  resolvedAt?: string;
}

export interface TransferObs {
  id?: number;
  date: string; // entered
  seenOn: string; // date seen in training or a match
  areaId: string;
  behaviour: string;
  author: string;
}

export interface Advancement {
  id?: number;
  areaId: string;
  from: string;
  to: string;
  date: string;
  decision: 'confirmed' | 'withheld';
  reason?: string;
  criteriaText: string;
  author: string;
}

export interface ExtraCriterion {
  id?: number;
  areaId: string;
  from: string;
  text: string;
  date: string;
  metAt?: string;
}

export interface Milestone {
  id: string; // stable key, so each milestone is shown once
  date: string;
  text: string;
  shownAt?: string;
}

export interface DemoClip {
  drillId: string;
  blob: Blob;
  mime: string;
  date: string;
}

export interface ProblemReport {
  id?: number;
  sessionRecordId: string;
  date: string;
  note: string;
  appVersion: string;
  contentVersion: string;
  cameraSetupVersion?: number;
  cueLog?: unknown;
}

export interface CueDrillOverride {
  id: string;
  date: string;
  author: string;
  drill: import('../content/types').CueDrill;
}

export type DrillFamily = 'L1' | 'L2' | 'L3' | 'L4';

export interface Pt {
  x: number; // 0..1 of the picture width
  y: number; // 0..1 of the picture height
}

export interface CameraSetup {
  id?: number;
  drillFamily: DrillFamily;
  deviceId: string;
  deviceLabel: string;
  referenceFrame: Blob;
  width: number;
  height: number;
  zones: { name: string; polygon: Pt[] }[];
  tripwire?: Pt[];
  floorPoints: { name: string; img: Pt; floor: [number, number] }[]; // floor in metres
  homography?: number[]; // 3×3, picture (0..1) → floor (m)
  mirror: boolean;
  createdAt: string;
  retiredAt?: string;
}

export interface Clip {
  id: string;
  blob: Blob;
  mime: string;
  drillId?: string;
  blockLabel: string;
  sessionRecordId: string;
  blockIndex: number;
  attempt: number;
  date: string;
  durationS: number;
  cameraSetupId?: number;
  keep?: boolean;
  /** Active-time ms of the block at which recording started, to align with the cue log. */
  startActiveMs: number;
}

export interface RepAnalysisRow {
  id: string;
  clipId: string;
  repIndex: number;
  data: import('../analysis/types').RepAnalysis;
}

export interface BlockAnalysisRow {
  id: string; // = clipId
  clipId: string;
  date: string;
  data: import('../analysis/types').BlockAnalysis;
}

export interface HistoryEntry {
  id?: number;
  date: string;
  author: string;
  action: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Part 16 §10 additions (schema version 3). See plan/15 D15.

export type UsableSpaceClass = 'compact' | 'standard' | 'extended';

export interface RoomAnchor {
  id: string;
  label: string; // "desk corner", "bookcase edge"
  pt: Pt; // where it is in the saved photo
  /** Small grey patch around the anchor (16×16, 0..255), for the launch consistency check. */
  patch?: number[];
}

export interface RoomProfile {
  id: string;
  name: string; // "Living room", parent-chosen
  version: number; // bumps when the polygon, anchors or mount change
  createdAt: string;
  updatedAt: string;
  /** Non-identifying capture parameters: device label hash, resolution. */
  cameraFingerprint?: { deviceLabelHash: string; width: number; height: number };
  deviceId?: string;
  backgroundFrame?: Blob; // the saved camera photo
  /** 64×36 grey thumbnail of the photo, for the launch check. */
  backgroundThumb?: number[];
  anchors: RoomAnchor[];
  mountConfirmed: boolean;
  safePolygonNormalized: Pt[]; // in photo coordinates 0..1
  clearanceSetting: number; // padding in metres-equivalent, conservative default
  usableSpaceClass: UsableSpaceClass;
  /** Where the class came from: the parent's pick, the safe polygon on the photo, or approximate dimensions. */
  spaceSource: 'parentClass' | 'polygon' | 'approxDims';
  /** Only when the parent entered one known measurement; never inferred. */
  scaleMetersPerPixel?: number;
  scaleSource?: 'parentMeasurement' | 'migratedRoomDimensions' | 'none';
  scaleConfidence?: 'low' | 'medium';
  /** Approximate usable floor in metres, when the parent gave it. Optional: no measuring is required. */
  approxUsableM?: { length: number; width: number };
  floor: 'hard' | 'carpet' | 'rubber';
  wallUsable: boolean;
  savedLayoutRefs: string[];
  lastVerifiedAt?: string;
  retiredAt?: string;
}

export type LayoutVerification = 'confirmed' | 'suggested' | 'cameraUnverified';

export interface LayoutInstance {
  id: string;
  roomProfileId: string;
  roomProfileVersion: number;
  layoutId: string; // L1–L4
  layoutVersion: number;
  createdAt: string;
  /** Suggested or parent-adjusted cone positions in photo coordinates. */
  observedConePositionsNormalized: { name: string; pt: Pt }[];
  verificationStatus: LayoutVerification;
  safeZones: { name: string; polygon: Pt[] }[];
  gateZones: { name: string; polygon: Pt[] }[];
  geometryClass: UsableSpaceClass;
}

export type MetricStatus = 'verified' | 'estimate' | 'unableToAssess';
export type MetricSource = 'appCue' | 'camera' | 'manual' | 'coach';

/** Part 15 D11 extended context key: results only join a trend when every field matches. */
export interface ContextKey {
  drillId?: string;
  benchmarkId?: string;
  layoutVersion: number;
  cueLevel: string;
  roomProfileVersion?: string; // `${profileId}@${version}`
  defenderArchetype?: string; // or 'benchmarkOpponent'
  taskMode?: string;
  cameraConfidence?: 'none' | 'low' | 'ok';
  ballProfileId?: string;
  modelVersion?: string;
  settings?: string;
}

export interface MetricObservation {
  id?: number;
  metricId: string;
  sessionRecordId?: string;
  blockIndex?: number;
  repIndex?: number;
  value?: number;
  unit?: string;
  status: MetricStatus;
  confidence?: number; // 0..1, never shown as accuracy
  source: MetricSource;
  contextKey: ContextKey;
  recordedAt: string;
  detectorVersion?: string;
}

export type DefenderReaction = 'commit' | 'hold' | 'delay' | 'commitOpposite' | 'commitThenRecover';
export type Side = 'left' | 'right';

export interface DefenderScenario {
  id: string;
  sessionRecordId?: string;
  blockIndex?: number;
  repIndex: number;
  view: 'player3d' | 'fallback2d';
  archetype: string; // earlyCommit | holding | reactive | benchmarkOpponent
  difficulty: number;
  reactionSeed: number;
  approachAngleDeg: number;
  approachSpeed: number;
  approachMs: number;
  initialSide: Side | 'centre';
  reaction: DefenderReaction;
  commitDirection?: Side;
  strength: number;
  reactionDelayMs: number;
  recovery: boolean;
  /** Times (block active ms) the defender's states began, for replay and timing. */
  cueEvents: { state: string; atMs: number }[];
  triggerSource: 'plannedTiming' | 'parentTrigger' | 'playerTrigger' | 'cameraOnset';
  rendererVersion: string;
  correctExit: Side | 'protect';
  /** Tunable game-design probabilities used (part 15 D4); illustrative, not empirical. */
  parametersVersion: string;
  /** Fake direction when the camera saw it (slice 3). */
  feintDirection?: Side;
  /** Block attempt the rep belongs to. */
  attempt?: number;
}

export interface MeasureStatusMap {
  [measure: string]: MetricStatus;
}

export interface FeintRep {
  repId: string; // `${scenarioId}`
  scenarioId: string;
  sessionRecordId?: string;
  initialFeintDirection?: Side;
  feintFeatureObservations: { feature: string; value?: number; status: MetricStatus; confidence?: number }[];
  techniqueRubric?: { fake: number; exit: number; eyes: number };
  techniqueStatus: 'observedExecution' | 'estimatedTechnique' | 'unableToAssess' | 'coachVerified';
  defenderReaction: DefenderReaction;
  selectedExit?: Side | 'protect';
  finalValidExit: Side | 'protect';
  controlledExit?: boolean;
  earlyCommitmentEvidence?: string; // possibleEarlyRouteCommitment only with evidence
  secondCueAdaptation?: boolean;
  timeToExitMs?: number;
  timingUncertaintyMs?: number;
  measureStatuses: MeasureStatusMap;
}

export interface ScanRep {
  repId: string;
  sessionRecordId?: string;
  blockIndex?: number;
  cueSequence: string[];
  cueTimeMs?: number;
  firstTouchTimeMs?: number;
  headOrientationBeforeTouch?: 'toward' | 'away' | 'unknown';
  scanProxyStatus: MetricStatus;
  selectedChannel?: string;
  correctDecision?: boolean;
  controlledFirstTouch?: boolean;
  cueAvailabilityCondition: 'visible' | 'hidden' | 'noInformation';
  scanMode: string;
  observations: { metric: string; status: MetricStatus; confidence?: number }[];
}

/** Coach edits to a drill's measure configuration (content holds the defaults). */
export interface FocusMetricConfigRow {
  drillId: string;
  date: string;
  author: string;
  config: import('../content/types').FocusMetricConfig;
}

// Part 17: ball profiles.
export interface BallProfile {
  id: string;
  name: string;
  createdAt: string;
  /** Colour model: mean and spread of hue/saturation/value over the registered samples. */
  colour: { h: number; s: number; v: number; hSpread: number; sSpread: number; vSpread: number };
  /** Apparent diameter in pixels at the samples' positions (for size gating), with the y of each sample. */
  sizeSamples: { y: number; diameterPx: number }[];
  /** Width (px) of the frames the size samples were measured on. */
  frameWidth: number;
  /** Share of background pixels the colour model wrongly accepts (lower is better). */
  backgroundMatchShare: number;
  captureKinds: string[];
  negatives: number; // background samples kept for the sufficiency check
  sampleCount: number;
  sufficiency: 'sufficient' | 'insufficient';
  active: boolean;
  thumb?: Blob;
}

// Part 18: continuous learning.
export type LearningComponent = 'ballRecognition' | 'touchClassification' | 'feintExecution' | 'scanPattern' | 'defenderTendency';

export interface ModelVersion {
  id: string; // `${component}@${n}`
  component: LearningComponent;
  n: number;
  createdAt: string;
  kind: 'base' | 'personalised';
  /** Statistical parameters (thresholds, class means) — never a neural network here. */
  params: Record<string, number>;
  heldOutAccuracy?: number;
  baseAccuracy?: number;
  examplesUsed: number;
  status: 'candidate' | 'active' | 'rejected' | 'retired';
  activatedAt?: string;
  note?: string;
}

export interface LearningExample {
  id: string;
  component: LearningComponent;
  createdAt: string;
  features: Record<string, number>;
  label?: string;
  labelSource?: 'flaggedRepReview' | 'blindCalibration' | 'coachVerification';
  verified: boolean;
  sessionRecordId?: string;
  context: { layoutVersion?: number; roomProfileVersion?: string; lighting?: string };
  inValidationSet: boolean;
}

export interface ValidationDataset {
  id: string; // component
  component: LearningComponent;
  frozenAt: string;
  exampleIds: string[];
}

export interface LearningSettings {
  id: 'main';
  paused: boolean;
  components: Partial<Record<LearningComponent, { paused: boolean; resetAt?: string }>>;
}

export interface FeatureFlags {
  defender3d: boolean;
  /** The 3D defender's body moves with recorded human motion (src/defender/mocap.ts). */
  realisticDefender?: boolean;
  /** Experimental rapid-touch counting from ball tracking (plan/09 task 6.7). */
  rapidTouches?: boolean;
  liveOnsetDetector: boolean;
  speechDiagnostic: boolean;
  notifications: boolean;
  ballTracking: boolean;
  learning: boolean;
  /** Experimental, off by default: suggest cone positions from the room photo (colour), always confirmed by the parent. */
  coneDetection: boolean;
  /** Experimental, off by default: MediaPipe object detector ("sports ball") alongside the colour model; downloads a model. */
  neuralBallDetector: boolean;
}

export interface Capabilities {
  checkedAt: string;
  webgl: boolean;
  webgl2: boolean;
  renderer?: string;
  maxTextureSize?: number;
  /** Measured by the 3D defender test in parent mode. */
  defenderFps?: number;
  defenderFpsAt?: string;
  /** Measured by Parent → Balls → detector speed test. */
  ballDetectorFps?: number;
  ballDetectorDelegate?: string;
  ballDetectorAt?: string;
}

export interface TimingBudget {
  measuredAt: string;
  cameraFps: number;
  droppedFramePct: number;
  renderFps?: number;
  /** Delay from a frame's capture to its arrival in the page (captureTime available in Chrome for webcams). */
  captureToPageMs?: number;
  /** Spread of that delay: the camera-to-render clock alignment error used as timing uncertainty. */
  alignmentErrorMs?: number;
  /** Cue display: frames between the cue state change and its first painted frame. */
  cueDisplayMs?: number;
}
