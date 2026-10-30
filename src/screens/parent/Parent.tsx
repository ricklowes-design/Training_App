import { readiness, READY_SYMBOL, READY_TEXT } from '../../domain/readiness';
import { useData } from '../../app/data';
import { useNav, type ParentSection } from '../../app/nav';
import { backupDue } from '../helpers';
import { PinGate } from './PinGate';
import { AdvancementSection, DrillsSection, HistorySection, NotesSection, PrioritiesSection, SessionsSection } from './Coach';
import { BackupSection, ContentSection, DemosSection, ResultsSection, ExportSection, PlacementSection, RoomSection, TrialsSection } from './DataSections';
import { SettingsSection } from './SettingsSection';
import { CueSection } from './CueSection';
import { CameraSection } from './CameraSection';
import { ClipsSection, PoseTestSection, TimingBudgetSection } from './CameraTools';
import { DefenderTestSection } from './DefenderTest';
import { ValidationSection } from './Validation';
import { BallsSection } from './Balls';
import { LearningSection } from './Learning';
import { SystemTestSection } from './SystemTest';

type TileGroup = 'training' | 'progress' | 'camera' | 'advanced';

// The parent tools in four groups (Brief R06).
const GROUPS: { id: TileGroup; title: string }[] = [
  { id: 'training', title: 'Training' },
  { id: 'progress', title: 'Progress' },
  { id: 'camera', title: 'Camera readiness' },
  { id: 'advanced', title: 'Advanced' },
];

const TILES: { section: ParentSection; title: string; detail: string; group: TileGroup }[] = [
  { section: 'systest', title: 'System test', detail: 'Every feature switched on, one run through; what worked and why not', group: 'camera' },
  { section: 'notes', title: 'Coach notes', detail: 'Note on a drill, session or area', group: 'training' },
  { section: 'drills', title: 'Adjust drills', detail: 'Cues, reps, demo link; new drills', group: 'training' },
  { section: 'sessions', title: 'Session blocks', detail: 'Add, replace or remove a drill', group: 'training' },
  { section: 'cues', title: 'Cue drills', detail: 'Cue values, timing, catch trials, second cue', group: 'training' },
  { section: 'advancement', title: 'Advancement', detail: 'Confirm or withhold a stage', group: 'progress' },
  { section: 'priorities', title: 'Priorities', detail: 'Priority skills per area', group: 'training' },
  { section: 'placement', title: 'Placement', detail: 'Starting session per area', group: 'training' },
  { section: 'trials', title: 'Trials', detail: 'Keep, make a trial, trial period, problem reports', group: 'training' },
  { section: 'results', title: 'Benchmark results', detail: 'Mark a result unreliable (start tone missed…)', group: 'progress' },
  { section: 'demos', title: 'Demonstrations', detail: 'Own clips and video links', group: 'training' },
  { section: 'export', title: 'Export for the coach', detail: 'Text summary of one area', group: 'progress' },
  { section: 'history', title: 'History', detail: 'Every change; revert overrides', group: 'advanced' },
  { section: 'camera', title: 'Camera set-up', detail: 'USB webcam, reference photos, cones, zones', group: 'camera' },
  { section: 'clips', title: 'Clips', detail: 'Replay, flagged reps, keep or delete', group: 'camera' },
  { section: 'posetest', title: 'Pose speed test', detail: 'How fast pose runs on this Chromebook', group: 'advanced' },
  { section: 'defender', title: '3D defender test', detail: 'Frame rate and the reactions, from the far end', group: 'advanced' },
  { section: 'timing', title: 'Timing budget', detail: 'Camera and screen timing before thresholds', group: 'advanced' },
  { section: 'balls', title: 'Balls', detail: 'Ball check (which ball works best), register a ball, switch balls', group: 'camera' },
  { section: 'learning', title: 'Learning', detail: 'Personalised models, validation, rollback', group: 'advanced' },
  { section: 'validation', title: 'Validation', detail: 'Camera measures checked against your reading', group: 'camera' },
  { section: 'room', title: 'Room profiles', detail: 'Photo, anchors, safe floor, cone positions', group: 'camera' },
  { section: 'settings', title: 'Settings', detail: 'Sound, week, timings, PIN', group: 'advanced' },
  { section: 'backup', title: 'Backup', detail: 'Export and import', group: 'advanced' },
  { section: 'content', title: 'Content', detail: 'Programme file and drills list', group: 'advanced' },
];

/** Training / recording / measures readiness, each with the one screen that fixes it (Brief R06). */
function Readiness() {
  const d = useData();
  const { go } = useNav();
  const items = readiness(d.programme, d.settings, d.roomProfile, d.cameraSetups);
  return (
    <div className="card stack" data-testid="readiness" style={{ marginBottom: 16 }}>
      <h2 style={{ margin: 0 }}>Readiness</h2>
      {items.map((it) => (
        <div key={it.id} className="row spread" data-testid={`ready-${it.id}`} data-state={it.state}>
          <div>
            <strong>
              <span aria-hidden="true">{READY_SYMBOL[it.state]}</span> {it.label}: {READY_TEXT[it.state]}
            </strong>
            <div className="muted">{it.text}</div>
          </div>
          {it.fix && it.state !== 'ready' ? (
            <button className="btn small" onClick={() => go({ name: 'parent', section: it.fix!.section })}>
              {it.fix.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function Parent({ section, arg }: { section: ParentSection; arg?: string }) {
  const d = useData();
  const { go, parentUnlocked, setParentUnlocked } = useNav();
  if (!parentUnlocked) return <PinGate onOk={() => setParentUnlocked(true)} />;

  let body: JSX.Element;
  switch (section) {
    case 'hub':
      body = (
        <>
          {backupDue(d) ? (
            <div className="note-box" style={{ marginBottom: 16 }}>
              A backup is due (monthly reminder). <button className="btn small" onClick={() => go({ name: 'parent', section: 'backup' })}>Back up now</button>
            </div>
          ) : null}
          <Readiness />
          {GROUPS.map((g) => (
            <section key={g.id} aria-labelledby={`group-${g.id}`}>
              <h2 id={`group-${g.id}`}>{g.title}</h2>
              <div className="grid3">
                {TILES.filter((t) => t.group === g.id).map((t) => (
                  <button key={t.section} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go({ name: 'parent', section: t.section })}>
                    <h3>{t.title}</h3>
                    <span className="muted">{t.detail}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => go({ name: 'setup' })}>
              Re-run first-run set-up
            </button>
          </div>
        </>
      );
      break;
    case 'settings':
      body = <SettingsSection />;
      break;
    case 'room':
      body = <RoomSection />;
      break;
    case 'backup':
      body = <BackupSection />;
      break;
    case 'content':
      body = <ContentSection />;
      break;
    case 'notes':
      body = <NotesSection />;
      break;
    case 'drills':
      body = <DrillsSection drillId={arg} />;
      break;
    case 'sessions':
      body = <SessionsSection sessionId={arg} />;
      break;
    case 'priorities':
      body = <PrioritiesSection />;
      break;
    case 'advancement':
      body = <AdvancementSection />;
      break;
    case 'history':
      body = <HistorySection />;
      break;
    case 'trials':
      body = <TrialsSection />;
      break;
    case 'demos':
      body = <DemosSection />;
      break;
    case 'results':
      body = <ResultsSection />;
      break;
    case 'placement':
      body = <PlacementSection />;
      break;
    case 'export':
      body = <ExportSection />;
      break;
    case 'cues':
      body = <CueSection />;
      break;
    case 'camera':
      body = <CameraSection />;
      break;
    case 'clips':
      body = <ClipsSection />;
      break;
    case 'posetest':
      body = <PoseTestSection />;
      break;
    case 'defender':
      body = <DefenderTestSection />;
      break;
    case 'timing':
      body = <TimingBudgetSection />;
      break;
    case 'validation':
      body = <ValidationSection />;
      break;
    case 'balls':
      body = <BallsSection />;
      break;
    case 'systest':
      body = <SystemTestSection runId={arg} />;
      break;
    case 'learning':
      body = <LearningSection />;
      break;
    default:
      body = <p>Not available yet.</p>;
  }
  const title = section === 'hub' ? 'Parent and coach mode' : TILES.find((t) => t.section === section)?.title ?? section;
  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ margin: 0 }}>{title}</h1>
        <div className="row">
          {section !== 'hub' ? (
            <button className="btn" onClick={() => go({ name: 'parent', section: 'hub' })}>
              Parent menu
            </button>
          ) : null}
          <button
            className="btn"
            onClick={() => {
              setParentUnlocked(false);
              go({ name: 'home' });
            }}
          >
            Close parent mode
          </button>
        </div>
      </div>
      {body}
    </div>
  );
}
