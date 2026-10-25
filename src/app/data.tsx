import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Programme } from '../content/types';
import { db } from '../db/db';
import type {
  Advancement,
  BenchmarkResult,
  CoachNote,
  CustomDrill,
  CueDrillOverride,
  CameraSetup,
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
  FocusMetricConfigRow,
} from '../db/types';
import { layoutForProfile } from '../domain/room';
import { applyOverrides } from '../domain/overrides';

export const APP_VERSION = __APP_VERSION__;

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  firstRunDone: false,
  weekStartDay: 1,
  weeklyTarget: 3,
  practiceDays: [1, 3, 4, 6],
  sound: { tones: true, speech: true, endOfSessionLine: true, volume: 0.9, voiceRate: 0.95 },
  milestoneCards: true,
  weeklySummary: true,
  backupReminder: true,
  equipment: { cones: 12, sparePhone: false, tripod: false },
  priorities: [],
  partnerAvailable: false,
  demoChoice: {},
  cardAutoAdvanceS: 20,
  demoAutoStartS: 20,
  cueEngine: true,
  camera: { enabled: false, retentionDays: 30, pose: 'off', analysisFps: 15 },
  // Part 16 feature flags. The 3D defender is the default for scored reactive drills (D3);
  // the live onset detector waits for its validation (D5); the others are opt-in.
  units: 'metric',
  flags: { defender3d: true, realisticDefender: false, liveOnsetDetector: false, speechDiagnostic: false, notifications: false, ballTracking: false, learning: false, coneDetection: false, neuralBallDetector: false },
  gameDays: [],
};

export async function ensureSettings(): Promise<void> {
  const s = await db.settings.get('main');
  if (!s) await db.settings.put(DEFAULT_SETTINGS);
  else await db.settings.put({ ...DEFAULT_SETTINGS, ...s, sound: { ...DEFAULT_SETTINGS.sound, ...s.sound }, camera: { ...DEFAULT_SETTINGS.camera, ...s.camera }, flags: { ...DEFAULT_SETTINGS.flags, ...s.flags } });
}

export interface AppData {
  base: Programme;
  programme: Programme; // with coach overrides applied
  settings: Settings;
  player?: Player;
  layout?: RoomLayout;
  layouts: RoomLayout[];
  records: SessionRecord[];
  results: BenchmarkResult[];
  placements: Placement[];
  overrides: Override[];
  customDrills: CustomDrill[];
  notes: CoachNote[];
  transfers: TransferObs[];
  advancements: Advancement[];
  extraCriteria: ExtraCriterion[];
  milestones: Milestone[];
  demoClipIds: string[];
  problemReports: ProblemReport[];
  history: HistoryEntry[];
  cueDrillOverrides: CueDrillOverride[];
  cameraSetups: CameraSetup[];
  roomProfiles: RoomProfile[];
  /** The room profile sessions use (part 15 D1). */
  roomProfile?: RoomProfile;
}

const Ctx = createContext<AppData | null>(null);

export function useData(): AppData {
  const d = useContext(Ctx);
  if (!d) throw new Error('useData outside DataProvider');
  return d;
}

export function DataProvider({ base, children, loading }: { base: Programme; children: ReactNode; loading: ReactNode }) {
  const all = useLiveQuery(async () => {
    const [settings, player, layouts, records, results, placements, overrides, customDrills, notes, transfers, advancements, extraCriteria, milestones, demoClipIds, problemReports, history, cueDrillOverrides, cameraSetups, roomProfiles, focusRows] =
      await Promise.all([
        db.settings.get('main'),
        db.player.get('main'),
        db.layouts.orderBy('version').toArray(),
        db.sessionRecords.orderBy('date').toArray(),
        db.benchmarkResults.orderBy('date').toArray(),
        db.placements.toArray(),
        db.overrides.toArray(),
        db.customDrills.toArray(),
        db.coachNotes.toArray(),
        db.transferObs.toArray(),
        db.advancements.toArray(),
        db.extraCriteria.toArray(),
        db.milestones.toArray(),
        db.demoClips.toCollection().primaryKeys(),
        db.problemReports.toArray(),
        db.history.toArray(),
        db.cueDrills.toArray(),
        db.cameraSetups.toArray(),
        db.roomProfiles.toArray(),
        db.focusMetricConfigs.toArray(),
      ]);
    return { settings, player, layouts, records, results, placements, overrides, customDrills, notes, transfers, advancements, extraCriteria, milestones, demoClipIds, problemReports, history, cueDrillOverrides, cameraSetups, roomProfiles, focusRows };
  });

  const value = useMemo<AppData | null>(() => {
    if (!all || !all.settings) return null;
    return {
      base,
      programme: withFocusOverrides(applyOverrides(base, all.overrides, all.customDrills, all.cueDrillOverrides), all.focusRows),
      settings: all.settings,
      player: all.player,
      layout: layoutForProfile(all.layouts, all.settings.activeRoomProfileId) ?? all.layouts[all.layouts.length - 1],
      roomProfiles: all.roomProfiles,
      roomProfile: all.roomProfiles.find((r) => r.id === all.settings!.activeRoomProfileId),
      layouts: all.layouts,
      records: all.records,
      results: all.results,
      placements: all.placements,
      overrides: all.overrides,
      customDrills: all.customDrills,
      notes: all.notes,
      transfers: all.transfers,
      advancements: all.advancements,
      extraCriteria: all.extraCriteria,
      milestones: all.milestones,
      demoClipIds: all.demoClipIds as string[],
      problemReports: all.problemReports,
      history: all.history,
      cueDrillOverrides: all.cueDrillOverrides,
      cameraSetups: all.cameraSetups,
    };
  }, [all, base]);

  if (!value) return <>{loading}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Coach edits to a drill's measure configuration replace the content default. */
function withFocusOverrides(p: Programme, rows: FocusMetricConfigRow[]): Programme {
  if (!rows.length) return p;
  return { ...p, focusMetricConfig: { ...p.focusMetricConfig, ...Object.fromEntries(rows.map((r) => [r.drillId, r.config])) } };
}

export async function logHistory(author: string, action: string, detail: string): Promise<void> {
  await db.history.add({ date: new Date().toISOString(), author, action, detail });
}
