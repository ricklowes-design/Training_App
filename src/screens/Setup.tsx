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
import { Seg, todayISO } from '../ui/widgets';

const STEPS = ['Player', 'Room', 'Equipment', 'Priorities', 'Demonstrations', 'Backup and PIN'] as const;

export function Setup() {
  const { programme, settings, player, layout, roomProfile } = useData();
  const { go } = useNav();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(player?.name ?? '');
  const [foot, setFoot] = useState<Foot>(player?.dominantFoot ?? 'right');
  const [position, setPosition] = useState(player?.position ?? '');
  const [room, setRoom] = useState<RoomProfile>(roomProfile ?? newProfile('room-1', 'Main room', new Date().toISOString()));
  const [equipment, setEquipment] = useState(settings.equipment);
  const [priorities, setPriorities] = useState<string[]>(settings.priorities.length ? settings.priorities : programme.priorities);
  const [coachNote, setCoachNote] = useState('');
  const [demoChoice, setDemoChoice] = useState<Record<string, 'outside' | 'own'>>(settings.demoChoice);
  const [demoLinks, setDemoLinks] = useState<Record<string, string>>({});
  const [backup, setBackup] = useState(settings.backupReminder);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const coreMoves = programme.drills.filter((d) => programme.coreMoveDrills.includes(d.id));
  const allTags = [...new Set([...programme.priorities, ...programme.areas.flatMap((a) => a.priorityTags)])];

  const canNext = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return room.spaceSource !== 'approxDims' || ((room.approxUsableM?.length ?? 0) >= 2 && (room.approxUsableM?.width ?? 0) >= 1);
    if (step === 5) return settings.pinHash ? pin === '' || validPin(pin) : validPin(pin);
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
        priorities,
        demoChoice,
        backupReminder: backup,
        pinHash,
        lastBackupAt: settings.lastBackupAt ?? new Date().toISOString(),
      });
      await saveRoomProfile(room, programme, { ...DEFAULT_SETTINGS, ...settings, equipment });
      if (coachNote.trim()) {
        await db.coachNotes.add({ date: new Date().toISOString(), author: 'coach via parent', target: { kind: 'area', id: 'all' }, body: coachNote.trim() });
      }
      for (const [drillId, link] of Object.entries(demoLinks)) {
        if (demoChoice[drillId] === 'outside' && link.trim()) {
          const prev = programme.drills.find((d) => d.id === drillId)?.demo;
          await db.overrides.add({
            date: new Date().toISOString(),
            author: 'parent',
            target: { kind: 'drill', id: drillId },
            field: 'demo',
            value: { type: 'youtube', ref: link.trim() },
            previousValue: prev ? { type: prev.type, ref: prev.ref } : undefined,
          });
        }
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
        {step === 1 && (
          <>
            <p className="muted">
              The layouts below are the benchmark layout {layout ? `v${layout.version}` : 'v1'}. Changing the room later creates a new version; results are never compared across versions. The camera photo, furniture
              anchors and safe floor are optional and added later in Parent → Room profiles.
            </p>
            <RoomBasicsForm profile={room} onChange={setRoom} cones={equipment.cones} />
          </>
        )}
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
        {step === 4 && (
          <>
            <p className="muted">
              For each core move: paste an outside video link, or record the player's own demo later (recommended). Check that a link plays inside the app before relying on it; uploaders can
              disable embedding.
            </p>
            {coreMoves.map((d) => (
              <div key={d.id} className="card tight stack">
                <strong>
                  {d.id} · {d.name}
                </strong>
                <Seg
                  value={demoChoice[d.id] ?? 'own'}
                  onChange={(v) => setDemoChoice({ ...demoChoice, [d.id]: v })}
                  options={[
                    { value: 'own', label: 'Record own demo later' },
                    { value: 'outside', label: 'Use an outside video' },
                  ]}
                />
                {demoChoice[d.id] === 'outside' && (
                  <label className="field">
                    <span>YouTube link{d.demo.outsideSearchPhrase ? ` (search: "${d.demo.outsideSearchPhrase}")` : ''}</span>
                    <input type="url" value={demoLinks[d.id] ?? ''} onChange={(e) => setDemoLinks({ ...demoLinks, [d.id]: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" />
                  </label>
                )}
              </div>
            ))}
          </>
        )}
        {step === 5 && (
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
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </button>
        {step < STEPS.length - 1 ? (
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
