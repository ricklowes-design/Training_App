import { useData } from '../../app/data';
import { useNav, type ParentSection } from '../../app/nav';
import { backupDue } from '../helpers';
import { PinGate } from './PinGate';
import { AdvancementSection, DrillsSection, HistorySection, NotesSection, PrioritiesSection, SessionsSection, TransferSection } from './Coach';
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

const TILES: { section: ParentSection; title: string; detail: string }[] = [
  { section: 'systest', title: 'System test', detail: 'Every feature switched on, one run through; what worked and why not' },
  { section: 'notes', title: 'Coach notes', detail: 'Note on a drill, session or area' },
  { section: 'drills', title: 'Adjust drills', detail: 'Cues, reps, demo link; new drills' },
  { section: 'sessions', title: 'Session blocks', detail: 'Add, replace or remove a drill' },
  { section: 'cues', title: 'Cue drills', detail: 'Cue values, timing, catch trials, second cue' },
  { section: 'advancement', title: 'Advancement', detail: 'Confirm or withhold a stage' },
  { section: 'transfer', title: 'Transfer observation', detail: 'Seen in training or a match' },
  { section: 'priorities', title: 'Priorities', detail: 'Priority skills per area' },
  { section: 'placement', title: 'Placement', detail: 'Starting session per area' },
  { section: 'trials', title: 'Trials', detail: 'Keep, make a trial, trial period, problem reports' },
  { section: 'results', title: 'Benchmark results', detail: 'Mark a result unreliable (start tone missed…)' },
  { section: 'demos', title: 'Demonstrations', detail: 'Own clips and video links' },
  { section: 'export', title: 'Export for the coach', detail: 'Text summary of one area' },
  { section: 'history', title: 'History', detail: 'Every change; revert overrides' },
  { section: 'camera', title: 'Camera set-up', detail: 'USB webcam, reference photos, cones, zones' },
  { section: 'clips', title: 'Clips', detail: 'Replay, flagged reps, keep or delete' },
  { section: 'posetest', title: 'Pose speed test', detail: 'How fast pose runs on this Chromebook' },
  { section: 'defender', title: '3D defender test', detail: 'Frame rate and the reactions, from the far end' },
  { section: 'timing', title: 'Timing budget', detail: 'Camera and screen timing before thresholds' },
  { section: 'balls', title: 'Balls', detail: 'Ball check (which ball works best), register a ball, switch balls' },
  { section: 'learning', title: 'Learning', detail: 'Personalised models, validation, rollback' },
  { section: 'validation', title: 'Validation', detail: 'Camera measures checked against your reading' },
  { section: 'room', title: 'Room profiles', detail: 'Photo, anchors, safe floor, cone positions' },
  { section: 'settings', title: 'Settings', detail: 'Sound, week, timings, PIN' },
  { section: 'backup', title: 'Backup', detail: 'Export and import' },
  { section: 'content', title: 'Content', detail: 'Programme file and drills list' },
];

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
          <div className="grid3">
            {TILES.map((t) => (
              <button key={t.section} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go({ name: 'parent', section: t.section })}>
                <h3>{t.title}</h3>
                <span className="muted">{t.detail}</span>
              </button>
            ))}
          </div>
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
    case 'transfer':
      body = <TransferSection />;
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
