// Shapes of content/programme.json. The validator in validate.ts checks a parsed
// file against these and reports readable errors.

export type AreaId = string;

export interface VoiceStyle {
  name: string;
  note?: string;
  rate: number; // multiplies the parent's voice speed
  pitch: number; // 0..2, 1 = normal
  /** Regular expression on the standard line → what this style says instead ($1… for groups). */
  lines: { match: string; say: string }[];
}

export interface Layout {
  name: string;
  setup: string;
  /** Where the player stands to start, said at the countdown ("Walk to the start"). */
  start?: string;
  derivedFrom?: string[];
}

export interface Stage {
  id: string;
  order: number;
  name: string;
  sessions: number[];
}

export interface Warmup {
  minutes20: number;
  minutes30: number;
  minutes45: number;
  minutes60: number;
  steps: string[];
  basis: string;
}

export interface DemoRef {
  type: 'none' | 'youtube' | 'own';
  ref: string;
  ownDemoPlanned: boolean;
  outsideSearchPhrase: string | null;
  outsideMustShow: string | null;
  status: string;
  /** Title of the linked video, as published. */
  title?: string;
  /** Only this part of the linked video is shown (seconds); it loops. */
  startS?: number;
  endS?: number;
  /** Training modes the video actually teaches (Brief R01); absent = technique only, fits every mode. */
  modes?: string[];
  /** Other candidate videos a parent can switch to. */
  alternatives?: { ref: string; title: string; startS?: number; endS?: number }[];
}

/** How a block will actually run, so its instructions, speech and demo match it (Brief R01). */
export const TEACH_MODES = ['defender3d', 'cue', 'plain'] as const;
export type TeachMode = (typeof TEACH_MODES)[number];

export interface DrillTeaching {
  why?: string;
  /** Three short steps. */
  steps: string[];
  /** What the opponent can do and how to read it (defender mode); never which way is right on a rep. */
  read?: string[];
  success: string;
  commonError: string;
  easier: string;
  harder: string;
}

export interface Drill {
  id: string;
  areaId: AreaId;
  name: string;
  layoutId: string;
  purpose: string;
  setupText: string;
  prescription: string;
  /** One rep, step by step, for the player (shown before the block). */
  steps?: string[];
  /** The same rep when a wall can be used: kick at the wall, the cue comes on the bounce. */
  stepsWall?: string[];
  /** Teaching per training mode (Brief R01): what the player is told for the way the block will actually run. */
  teach?: Partial<Record<TeachMode, DrillTeaching>>;
  cues: string[];
  commonErrors: string[];
  demo: DemoRef;
  safety: string;
  variants: { solo: boolean; partner: null | { required: boolean } };
  mode: 'timed' | 'reps';
  cueDrillId?: string;
  /** Sets inside a block: the block's time is split evenly and each set is announced (plan/02 §2.6). */
  sets?: { count: number; labels?: string[] };
  /** false: an optional diagnostic, never offered as routine training (part 15 D8). */
  routine?: boolean;
  /** Scanning modes this drill supports (part 15 D9). */
  scanModes?: string[];
  /** The 3D defender configuration used when this drill is a scored reactive block (part 15 D3). */
  defenderDrillId?: string;
}

export interface DefenderDrill {
  id: string;
  name: string;
  rule: string;
  reps: number;
  repPeriodS: number;
  approachMinS: number;
  approachMaxS: number;
  approachAngleMaxDeg: number;
  archetypes: string[];
  difficulty: number;
  /** Reaction modes allowed in this drill; absent = follow the player's progression. */
  allowedModes?: string[];
  note?: string;
}

/** Part 16 §6: one or two focus measures per drill; experimental diagnostics never drive progression. */
export interface FocusMetricConfig {
  primary: string[];
  supporting: string[];
  experimental: string[];
  progressionEligible: string[];
  qualityGuardrails?: string[];
}

export interface DefenderArchetypeInfo {
  id: string;
  label: string;
  notes?: string;
}

export interface ScanMode {
  id: string;
  label: string;
  note: string;
  /** A room property the mode needs (e.g. wallUsable), or null. */
  requires: string | null;
}

export interface Area {
  id: AreaId;
  name: string;
  priorityTags: string[];
  benchmarkId: string;
}

export type ContentBlock =
  | { type: 'warmup' | 'rest' | 'log' | 'transition' | 'cooldown' | 'mobility' | 'break'; minutes: number }
  | { type: 'work'; minutes: number; drillId: string; params: string }
  | {
      type: 'benchmark';
      minutes: number;
      benchmarkId: string;
      cueLevel: string;
      alsoCueAccuracy?: boolean;
      coachTransferRequested?: boolean;
    };

export interface ContentSession {
  id: string;
  areaId: AreaId;
  number: number;
  stageId: string;
  durationMinutes: number;
  blocks: ContentBlock[];
}

export interface RubricItem {
  item: string;
  [score: string]: string;
}

export interface Benchmark {
  id: string;
  areaId: AreaId | null;
  name: string;
  metrics: string[];
  cueLevels: string[];
  protocol: string;
  rubric?: RubricItem[];
}

export type CatchType = 'noCue' | 'blockedShaping' | 'lateCue';

export interface CueDrill {
  id: string;
  name: string;
  cueTypes: string[];
  values?: string[];
  rule: string;
  /** For the player: what they will see and when, what to do for each word, and a short spoken version. */
  howTo?: { why?: string; expect: string; words: Record<string, string>; say?: string };
  intervalMinS?: number;
  intervalMaxS?: number;
  delayAfterStartMinS?: number;
  delayAfterStartMaxS?: number;
  displayS?: number;
  durationS: number;
  soccerMeaning: string;
  /** 'rep': a start tone begins each rep and the cue follows (after the tripwire when the camera is set up).
   *  'interval': a new cue every intervalMinS–intervalMaxS seconds. */
  trigger?: 'rep' | 'interval';
  reps?: number;
  repPeriodS?: number;
  startToCueMinS?: number;
  startToCueMaxS?: number;
  tripwireDelayMinMs?: number;
  tripwireDelayMaxMs?: number;
  catchFraction?: number;
  catchTypes?: CatchType[];
  numbers?: boolean;
  secondCue?: { onValue: string; fraction: number; delayMinMs: number; delayMaxMs: number; values: string[] };
}

export interface Anchor {
  id: string;
  name: string;
  layoutId: string;
  drillId: string;
  conditions: Record<string, unknown>;
  minutes: number;
  metrics: string[];
}

export interface AnchorCheck {
  everyDays: number;
  blocks: ({ type: 'warmup'; minutes: number } | { type: 'anchor'; id: string; minutes: number })[];
  recordType: 'anchor';
  unlocks: false;
  countsTowardWeek: false;
}

export interface LayoutGeometry {
  defaults: { roomLengthM: number; roomWidthM: number; floor: string; wallUsable: boolean; cones: number };
  slalom: { cones: number; startFromWallM: number; stopZoneM: number; marginM: number; maxSpacingM: number; minSpacingM: number };
  feintLane: {
    startFromWallM: number;
    maxFeintConeM: number;
    gatePastConeM: number;
    gateWidthM: number;
    stopZoneM: number;
    /** Narrow-room version: gates closer to the lane and to the side walls, never narrower than minGateM. */
    narrow?: { innerM: number; wallGapM: number; minGateM: number };
    /** Single-cone version, for rooms too narrow (or too few cones) for gates: one exit cone to go left or right of. */
    single?: { minWidthM: number };
  };
  receiveBox: {
    maxSideM: number;
    sideClearanceM: number;
    gateWidthM: number;
    cueScreenBehindM: number;
    /** Narrow-room version: shorter exits either side of a box no smaller than minSideM. */
    narrow?: { sideClearanceM: number; minSideM: number };
    /** Single-cone version: two cones in a line instead of a box, exits left or right of them. */
    single?: { minWidthM: number; coneGapM: number };
  };
  masterySquare: { sideM: number };
}

export interface Baseline {
  areaId: AreaId;
  blocks: ContentBlock[];
  questions: string[];
  defaultStartSession: number;
}

export type BuilderSlot =
  | { type: 'warmup' | 'rest' | 'log' | 'transition' | 'cooldown' | 'mobility' | 'break'; minutes: number }
  | { type: 'work'; area: number; from: 'A' | 'B' | 'C'; minutes: number }
  | { type: 'benchmark'; area: number; minutes: number }
  | { type: 'quiz'; minutes: number; drillId: string };

export interface BuilderTemplate {
  id: string;
  minutes: number;
  areas: number;
  light?: boolean;
  slots: BuilderSlot[];
}

export interface Builder {
  note?: string;
  durations: number[];
  templates: BuilderTemplate[];
  noBall: { minutes: number; slots: BuilderSlot[] };
  restBetweenBlocksS: number;
  countdownS: number;
}

export interface Quiz {
  items: number;
  answerS: number;
  drillId: string;
  options: string[];
  note?: string;
}

export interface Check {
  metric: string;
  op: '>=' | '<=';
  value: number;
}

export interface AdvancementRule {
  areaId: AreaId;
  from: string;
  to: string; // a stage id or 'exit'
  benchmarkId?: string;
  cueLevels?: string[];
  drillIds?: string[];
  consecutive: number;
  checks: Check[];
  parentChecks?: string[];
  requiresTransfer?: boolean;
}

export interface SystemTestBlock {
  layoutId: string;
  drillId: string;
  minutes: number;
  /** What this block tests, in plain words for the parent. */
  tests: string;
  /** Feature checks (ids from src/domain/systemTest.ts). */
  checks: string[];
}

export interface SystemTestContent {
  title: string;
  note?: string;
  blocks: SystemTestBlock[];
  /** Things only a person can judge (sound, readability from the far end), asked after the run. */
  parentChecks: { id: string; question: string }[];
}

export interface Programme {
  version: string;
  generated: string;
  note: string;
  layouts: Record<string, Layout>;
  stages: Stage[];
  warmup: Warmup;
  drills: Drill[];
  areas: Area[];
  sessions: ContentSession[];
  benchmarks: Benchmark[];
  advancement: Record<string, Record<string, string>>;
  cueDrills: CueDrill[];
  feedbackTemplates: Record<string, string>;
  /** Spoken styles (e.g. the touchline coach): voice rate and pitch, and how each standard line is said. */
  voiceStyles?: Record<string, VoiceStyle>;
  anchors: Anchor[];
  anchorCheck: AnchorCheck;
  layoutGeometry: LayoutGeometry;
  baselines: Baseline[];
  placementRule: { note?: string; byYesCount: Record<string, number> };
  builder: Builder;
  quiz: Quiz;
  advancementRules: AdvancementRule[];
  regression: Record<string, string>;
  priorities: string[];
  coreMoveDrills: string[];
  benchmarkCueDrills?: Record<string, string>;
  benchmarkLayouts?: Record<string, string>;
  /** Parent → System test: every feature once, blocks grouped by cone layout. Never counts. */
  systemTest?: SystemTestContent;
  focusMetricConfig: Record<string, FocusMetricConfig>;
  reactionModesProgression: string[];
  defenderArchetypes: DefenderArchetypeInfo[];
  scanModes: ScanMode[];
  defenderDrills: DefenderDrill[];
  capstone: Capstone;
}

export interface CapstoneComponent {
  id: string;
  label: string;
  minReps: number;
  minAgreement: number;
  procedure: string;
}

export interface Capstone {
  id: string;
  name: string;
  chain: string[];
  note: string;
  components: CapstoneComponent[];
}
