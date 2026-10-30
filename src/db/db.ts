import Dexie, { type Table } from 'dexie';
import type {
  Advancement,
  BenchmarkResult,
  CoachNote,
  CustomDrill,
  CueDrillOverride,
  CameraSetup,
  Clip,
  RepAnalysisRow,
  BlockAnalysisRow,
  DemoClip,
  ExtraCriterion,
  HistoryEntry,
  Milestone,
  Override,
  Placement,
  Player,
  ProblemReport,
  RoomLayout,
  SessionRecord,
  Settings,
  TransferObs,
  RoomProfile,
  LayoutInstance,
  MetricObservation,
  DefenderScenario,
  FeintRep,
  ScanRep,
  FocusMetricConfigRow,
  BallProfile,
  ModelVersion,
  LearningExample,
  ValidationDataset,
  LearningSettings,
} from './types';
import { profileFromLegacyLayout } from '../domain/room';

export class TrainingDB extends Dexie {
  settings!: Table<Settings, 'main'>;
  player!: Table<Player, 'main'>;
  layouts!: Table<RoomLayout, number>;
  sessionRecords!: Table<SessionRecord, string>;
  benchmarkResults!: Table<BenchmarkResult, string>;
  placements!: Table<Placement, string>;
  overrides!: Table<Override, number>;
  customDrills!: Table<CustomDrill, string>;
  coachNotes!: Table<CoachNote, number>;
  transferObs!: Table<TransferObs, number>;
  advancements!: Table<Advancement, number>;
  extraCriteria!: Table<ExtraCriterion, number>;
  milestones!: Table<Milestone, string>;
  demoClips!: Table<DemoClip, string>;
  problemReports!: Table<ProblemReport, number>;
  history!: Table<HistoryEntry, number>;
  cueDrills!: Table<CueDrillOverride, string>;
  cameraSetups!: Table<CameraSetup, number>;
  clips!: Table<Clip, string>;
  repAnalyses!: Table<RepAnalysisRow, string>;
  blockAnalyses!: Table<BlockAnalysisRow, string>;
  roomProfiles!: Table<RoomProfile, string>;
  layoutInstances!: Table<LayoutInstance, string>;
  metricObservations!: Table<MetricObservation, number>;
  defenderScenarios!: Table<DefenderScenario, string>;
  feintReps!: Table<FeintRep, string>;
  scanReps!: Table<ScanRep, string>;
  focusMetricConfigs!: Table<FocusMetricConfigRow, string>;
  ballProfiles!: Table<BallProfile, string>;
  modelVersions!: Table<ModelVersion, string>;
  learningExamples!: Table<LearningExample, string>;
  validationDatasets!: Table<ValidationDataset, string>;
  learningSettings!: Table<LearningSettings, 'main'>;

  constructor(name = 'home-training') {
    super(name);
    this.version(1).stores({
      settings: 'id',
      player: 'id',
      layouts: 'version',
      sessionRecords: 'id, runId, kind, areaId, date',
      benchmarkResults: 'id, sessionRecordId, benchmarkId, date',
      placements: 'areaId',
      overrides: '++id, date',
      customDrills: 'id',
      coachNotes: '++id, date',
      transferObs: '++id, areaId',
      advancements: '++id, areaId',
      extraCriteria: '++id, areaId',
      milestones: 'id',
      demoClips: 'drillId',
      problemReports: '++id, date',
      history: '++id, date',
    });
    // Milestone 2: cue drills edited by the coach, camera set-ups, clips and their analyses.
    this.version(2).stores({
      cueDrills: 'id',
      cameraSetups: '++id, drillFamily',
      clips: 'id, date, sessionRecordId',
      repAnalyses: 'id, clipId',
      blockAnalyses: 'id, clipId',
    });
    // Part 16 §10, part 17 and part 18 additions. Nothing existing is changed or removed;
    // a room profile is made from the earlier room measurements so drills keep their geometry.
    this.version(3)
      .stores({
        roomProfiles: 'id',
        layoutInstances: 'id, roomProfileId',
        metricObservations: '++id, metricId, sessionRecordId, recordedAt',
        defenderScenarios: 'id, sessionRecordId',
        feintReps: 'repId, scenarioId, sessionRecordId',
        scanReps: 'repId, sessionRecordId',
        focusMetricConfigs: 'drillId',
        ballProfiles: 'id',
        modelVersions: 'id, component',
        learningExamples: 'id, component',
        validationDatasets: 'id',
        learningSettings: 'id',
      })
      .upgrade(async (tx) => {
        const layouts = await tx.table<RoomLayout, number>('layouts').orderBy('version').toArray();
        const last = layouts[layouts.length - 1];
        if (!last) return;
        const now = new Date().toISOString();
        await tx.table('roomProfiles').put(profileFromLegacyLayout(last, now));
        await tx.table('settings').toCollection().modify((s: Settings) => {
          s.activeRoomProfileId = 'room-1';
        });
        await tx.table('history').add({ date: now, author: 'app', action: 'migration', detail: 'Schema 3: room profile made from the earlier room measurements; no records changed' });
      });
  }
}

export const db = new TrainingDB();
// Another open tab of the app is blocking an upgrade (Dexie closes on versionchange itself).
db.on('blocked', () => {
  if (typeof alert === 'function') alert('Close other tabs of this app so it can update, then reload.');
});

/** Tables included in the JSON backup. Demo clips and recorded clips are not included; photos (room profiles, floor maps,
 *  camera reference frames) are embedded as base64. Session-message credentials are left out (src/db/backup.ts). */
export const BACKUP_TABLES = [
  'settings',
  'player',
  'layouts',
  'sessionRecords',
  'benchmarkResults',
  'placements',
  'overrides',
  'customDrills',
  'coachNotes',
  'transferObs',
  'advancements',
  'extraCriteria',
  'milestones',
  'problemReports',
  'history',
  'cueDrills',
  'cameraSetups',
  'repAnalyses',
  'blockAnalyses',
  'roomProfiles',
  'layoutInstances',
  'metricObservations',
  'defenderScenarios',
  'feintReps',
  'scanReps',
  'focusMetricConfigs',
  'ballProfiles',
  'modelVersions',
  'learningExamples',
  'validationDatasets',
  'learningSettings',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];
