import { useState } from 'react';
import { DEFAULT_SETTINGS, logHistory, useData } from '../app/data';
import { useNav } from '../app/nav';
import { hashPin, validPin } from '../app/pin';
import { db } from '../db/db';
import { importBackup } from '../db/backup';
import { ensureSettings } from '../app/data';
import type { Foot, RoomProfile } from '../db/types';
import { newProfile } from '../domain/room';
import { saveRoomProfile } from '../app/room';
import { RoomBasicsForm } from './parent/RoomProfiles';
import { BallCheck } from './parent/BallCheck';
import { Register } from './parent/Balls';
import { useLiveQuery } from 'dexie-react-hooks';
import { previousStep, SpaceWizard, type WizardStep } from './space/SpaceWizard';
import { Seg, todayISO } from '../ui/widgets';

// Demonstrations are not a set-up step: approved videos and animations come with the drills (Parent → Demonstrations to change them).
const STEPS = ['Player', 'Your space', 'Equipment', 'Your ball', 'Recording', 'Priorities', 'Backup and PIN'] as const;

export function Setup() {
  const { programme, settings, player, layout, roomProfile } = useData();
  const { go } = useNav();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(player?.name ?? '');
  const [foot, setFoot] = useState<Foot>(player?.dominantFoot ?? 'right');
  const [position, setPosition] = useState(player?.position ?? '');
  // A new room starts on "Measure it": measured once here, every drill places its cones against it later.
  const [room, setRoom] = useState<RoomProfile>(roomProfile ?? { ...newProfile('room-1', 'Main room', new Date().toISOString()), spaceSource: 'approxDims', measured: true, approxUsableM: { length: 6.1, width: 3.0 } });
  const [equipment, setEquipment] = useState(settings.equipment);
  const [record, setRecord] = useState(settings.camera.enabled);
  const [priorities, setPriorities] = useState<string[]>(settings.priorities.length ? settings.priorities : programme.priorities);
  const [coachNote, setCoachNote] = useState('');
  const [backup, setBackup] = useState(settings.backupReminder);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  // Your ball: the ball check, then teaching the camera the chosen ball.
  const [registering, setRegistering] = useState<string | null>(null);
  const balls = useLiveQuery(() => db.ballProfiles.toArray(), []) ?? [];
  // The room: the guided measurement (measure → photo → measure from the photo → training space), or a size without a tape.
  // Re-running the set-up with a guided measurement already made opens on the training space.
  const [spaceStep, setSpaceStep] = useState<WizardStep>(roomProfile?.space ? 'space' : 'measure');
  const [noTape, setNoTape] = useState(!!roomProfile && roomProfile.spaceSource === 'parentClass');

  const allTags = [...new Set([...programme.priorities, ...programme.areas.flatMap((a) => a.priorityTags)])];

  const canNext = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return room.spaceSource !== 'approxDims' || ((room.approxUsableM?.length ?? 0) >= 2 && (room.approxUsableM?.width ?? 0) >= 1);
    if (step === 6) return settings.pinHash ? pin === '' || validPin(pin) : validPin(pin);
    return true;
  };

  async function finish() {
    setError('');
    try {
      await db.player.put({ id: 'main', name: name.trim(), dominantFoot: foot, position: position.trim() });
      const pinHash = pin ? await hashPin(pin) : settings.pinHash;
      await db.settings.put({
        ...DEFAULT_SETTINGS,
        ...settings,
        firstRunDone: true,
        equipment,
        camera: { ...settings.camera, enabled: record },
        priorities,
        backupReminder: backup,
        pinHash,
        lastBackupAt: settings.lastBackupAt ?? new Date().toISOString(),
      });
      await saveRoomProfile(room, programme, { ...DEFAULT_SETTINGS, ...settings, equipment });
      if (coachNote.trim()) {
        await db.coachNotes.add({ date: new Date().toISOString(), author: 'coach via parent', target: { kind: 'area', id: 'all' }, body: coachNote.trim() });
      }
      await logHistory('parent', 'first-run set-up', `Set-up completed ${todayISO()}`);
      go({ name: 'home' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1>Set-up · {STEPS[step]}</h1>
        <span className="muted">
          Step {step + 1} of {STEPS.length}
        </span>
      </div>
      <div className="card stack">
        {step === 0 && (
          <>
            <p className="muted">Kept only on this Chromebook.</p>
            {!settings.firstRunDone ? (
              <div className="row">
                <label className="btn small">
                  Restore from a backup file instead
                  <input
                    type="file"
                    accept="application/json,.json"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const r = await importBackup(db, await f.text());
                      if (!r.ok) return setError(r.error);
                      await ensureSettings();
                      window.location.reload();
                    }}
                  />
                </label>
              </div>
            ) : null}
            <label className="field">
              <span>Player's first name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <div className="row">
              <span className="muted">Dominant foot</span>
              <Seg value={foot} onChange={setFoot} options={[{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }]} />
            </div>
            <label className="field">
              <span>Position</span>
              <input type="text" value={position} onChange={(e) => setPosition(e.target.value)} />
            </label>
          </>
        )}
        {step === 1 &&
          (noTape ? (
            <>
              <p className="muted">
                Pick the size that looks right. Each drill shows where its cones go when it starts. Changing the room later creates a new layout version {layout ? `(now v${layout.version})` : ''}; results are never
                compared across versions.
              </p>
              <RoomBasicsForm profile={room} onChange={setRoom} cones={equipment.cones} showLayouts={false} sizeOnly />
              <div>
                <button className="btn" onClick={() => (setNoTape(false), setSpaceStep('measure'), setRoom({ ...room, spaceSource: 'approxDims', measured: true }))}>
                  Measure with a tape instead
                </button>
              </div>
            </>
          ) : (
            <SpaceWizard profile={room} onChange={setRoom} step={spaceStep} setStep={setSpaceStep} onNoTape={() => (setNoTape(true), setRoom({ ...room, spaceSource: 'parentClass', measured: false }))} />
          ))}
        {step === 2 && (
          <>
            <label className="field" style={{ maxWidth: 240 }}>
              <span>Cones</span>
              <input type="number" min="0" value={equipment.cones} onChange={(e) => setEquipment({ ...equipment, cones: Number(e.target.value) })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={equipment.sparePhone} onChange={(e) => setEquipment({ ...equipment, sparePhone: e.target.checked })} />
              Spare phone (for a cue screen)
            </label>
            <label className="check">
              <input type="checkbox" checked={equipment.tripod} onChange={(e) => setEquipment({ ...equipment, tripod: e.target.checked })} />
              Tripod or webcam mount
            </label>
          </>
        )}
        {step === 3 && (
          <>
            {registering !== null ? (
              <Register name0={registering} onDone={() => setRegistering(null)} />
            ) : (
              <>
                <p className="muted">
                  Optional, about 5 minutes with the webcam on the training floor: compare the balls you have, then teach the camera the best one so it can follow the ball in the drills. Press Next to
                  skip; Home reminds you before the first drills, and it is always in Parent → Balls.
                </p>
                {balls.length ? (
                  <p className="pill go" data-testid="ball-registered">
                    Ball for tracking: {balls.find((b) => b.active)?.name ?? balls[balls.length - 1].name}
                  </p>
                ) : null}
                <BallCheck onRegister={setRegistering} />
              </>
            )}
          </>
        )}
        {step === 4 && (
          <div className="stack" data-testid="recording-question">
            <h2 style={{ margin: 0 }}>Record the drills with the webcam?</h2>
            <p>
              Each drill is filmed so you or the coach can watch it back (Parent → Clips), and the app can check the reps. Clips stay on this Chromebook and are deleted after {settings.camera.retentionDays}{' '}
              days unless you keep one. Nothing is uploaded.
            </p>
            <Seg
              value={record ? 'yes' : 'no'}
              onChange={(v) => setRecord(v === 'yes')}
              options={[
                { value: 'yes', label: 'Yes, record the drills' },
                { value: 'no', label: 'No recording' },
              ]}
            />
            <p className="muted">For the rep-by-rep checks too, set the camera up once for each drill area in Parent → Camera set-up (about 2 minutes each). Recording works without it.</p>
          </div>
        )}
        {step === 5 && (
          <>
            <p className="muted">Tick the priority skills. They show on the Skills tab and break ties in the next-session suggestion.</p>
            {allTags.map((t) => (
              <label className="check" key={t}>
                <input type="checkbox" checked={priorities.includes(t)} onChange={(e) => setPriorities(e.target.checked ? [...priorities, t] : priorities.filter((x) => x !== t))} />
                {t}
              </label>
            ))}
            <label className="field">
              <span>Coach notes so far (optional; the first entry in the coach log)</span>
              <textarea value={coachNote} onChange={(e) => setCoachNote(e.target.value)} />
            </label>
          </>
        )}
        {step === 6 && (
          <>
            <p>
              Everything lives only in this browser on this Chromebook. If Chrome's site data is cleared, it is gone unless there is a backup. A backup is one file you save to Downloads or Google
              Drive.
            </p>
            <label className="check">
              <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
              Remind me to back up once a month
            </label>
            <label className="field" style={{ maxWidth: 300 }}>
              <span>{settings.pinHash ? 'New parent PIN (leave empty to keep the current one)' : 'Parent PIN (4 digits)'}</span>
              <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </label>
            <p className="muted">The room photo, furniture anchors and safe floor (Parent → Room profiles) and the webcam (Parent → Camera set-up) are optional and can be added later.</p>
          </>
        )}
        {error ? <div className="error-box">{error}</div> : null}
      </div>
      <div className="row spread" style={{ marginTop: 16 }}>
        <button
          className="btn"
          disabled={step === 0}
          onClick={() => {
            // Inside "Your space", Back goes to the previous room step first.
            const prev = step === 1 && !noTape ? previousStep(spaceStep) : null;
            if (prev) setSpaceStep(prev);
            else setStep(step - 1);
          }}
        >
          Back
        </button>
        {step === 1 && !noTape && spaceStep !== 'space' ? (
          <span className="muted">Follow the steps above</span>
        ) : step < STEPS.length - 1 ? (
          <button className="btn primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <button className="btn primary" disabled={!canNext()} onClick={finish}>
            Finish set-up
          </button>
        )}
      </div>
    </div>
  );
}
