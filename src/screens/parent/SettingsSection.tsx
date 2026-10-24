import { useEffect, useState } from 'react';
import { listVoices, say, setSoundSettings, tone, unlockAudio } from '../../audio/audio';
import { logHistory, useData } from '../../app/data';
import { hashPin, validPin } from '../../app/pin';
import { db } from '../../db/db';
import type { Settings } from '../../db/types';
import { Seg, Stepper } from '../../ui/widgets';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function SettingsSection() {
  const { settings } = useData();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [pin, setPin] = useState('');
  const [pinMsg, setPinMsg] = useState('');

  useEffect(() => {
    const load = () => setVoices(listVoices());
    load();
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load);
  }, []);

  const save = (patch: Partial<Settings>) => db.settings.update('main', patch);
  const saveSound = (patch: Partial<Settings['sound']>) => {
    const sound = { ...settings.sound, ...patch };
    setSoundSettings(sound);
    return db.settings.update('main', { sound });
  };

  return (
    <div className="stack">
      <div className="card stack">
        <h2>Sound</h2>
        <p className="muted">Everything inside a block is spoken. Turn both off for silent use.</p>
        <label className="check">
          <input type="checkbox" checked={settings.sound.speech} onChange={(e) => saveSound({ speech: e.target.checked })} />
          Spoken cues
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.sound.tones} onChange={(e) => saveSound({ tones: e.target.checked })} />
          Tones (start, 30-second warning, end of block)
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.sound.endOfSessionLine} onChange={(e) => saveSound({ endOfSessionLine: e.target.checked })} />
          Speak the end-of-session line
        </label>
        <Stepper label="Volume %" value={Math.round(settings.sound.volume * 100)} min={10} max={100} step={10} onChange={(v) => saveSound({ volume: v / 100 })} />
        <Stepper label="Voice speed %" value={Math.round(settings.sound.voiceRate * 100)} min={50} max={150} step={5} onChange={(v) => saveSound({ voiceRate: v / 100 })} />
        <label className="field">
          <span>Voice</span>
          <select value={settings.sound.voiceURI ?? ''} onChange={(e) => saveSound({ voiceURI: e.target.value || undefined })}>
            <option value="">Default English voice</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang}){v.localService ? '' : ' · online'}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              unlockAudio();
              setSoundSettings(settings.sound);
              tone('start');
              say('Set two. Left exit. Go. Thirty seconds.');
            }}
          >
            Test sound from the far end
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>Week</h2>
        <Stepper label="Weekly target (sessions)" value={settings.weeklyTarget} min={1} max={7} onChange={(weeklyTarget) => save({ weeklyTarget })} />
        <div className="row">
          <span className="muted">Week starts</span>
          <Seg value={settings.weekStartDay} onChange={(weekStartDay) => save({ weekStartDay })} options={[{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }]} />
        </div>
        <div className="row">
          <span className="muted">Club practice days</span>
          {DAYS.map((d, i) => (
            <label key={d} className="check">
              <input
                type="checkbox"
                checked={settings.practiceDays.includes(i)}
                onChange={(e) => save({ practiceDays: e.target.checked ? [...settings.practiceDays, i].sort() : settings.practiceDays.filter((x) => x !== i) })}
              />
              {d}
            </label>
          ))}
        </div>
        <div className="row">
          <span className="muted">Game days (lighter sessions suggested)</span>
          {DAYS.map((d, i) => (
            <label key={d} className="check">
              <input
                type="checkbox"
                aria-label={`Game day ${d}`}
                checked={settings.gameDays.includes(i)}
                onChange={(e) => save({ gameDays: e.target.checked ? [...settings.gameDays, i].sort() : settings.gameDays.filter((x) => x !== i) })}
              />
              {d}
            </label>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.partnerAvailable} onChange={(e) => save({ partnerAvailable: e.target.checked })} />
          A partner is usually available
        </label>
      </div>

      <div className="card stack">
        <h2>Screens</h2>
        <Stepper label="End-of-drill card: Next after (s)" value={settings.cardAutoAdvanceS} min={5} max={120} step={5} onChange={(cardAutoAdvanceS) => save({ cardAutoAdvanceS })} />
        <Stepper label="Demo view: start block after (s)" value={settings.demoAutoStartS} min={5} max={180} step={5} onChange={(demoAutoStartS) => save({ demoAutoStartS })} />
        <label className="check">
          <input type="checkbox" checked={settings.cueEngine} onChange={(e) => save({ cueEngine: e.target.checked })} />
          Cue engine: show cues full screen in cue drills (off = use SwitchedOn and log cue accuracy by hand)
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.milestoneCards} onChange={(e) => save({ milestoneCards: e.target.checked })} />
          Milestone cards
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.backupReminder} onChange={(e) => save({ backupReminder: e.target.checked })} />
          Monthly backup reminder
        </label>
      </div>

      <FeaturesCard />

      <div className="card stack">
        <h2>Parent PIN</h2>
        <div className="row">
          <input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} style={{ maxWidth: 160 }} />
          <button
            className="btn"
            disabled={!validPin(pin)}
            onClick={async () => {
              await save({ pinHash: await hashPin(pin) });
              await logHistory('parent', 'PIN changed', '');
              setPin('');
              setPinMsg('PIN changed.');
            }}
          >
            Change PIN
          </button>
          <span className="muted">{pinMsg}</span>
        </div>
      </div>
    </div>
  );
}

const FLAG_TEXT: { key: keyof Settings['flags']; label: string; detail: string }[] = [
  { key: 'defender3d', label: '3D defender', detail: 'Scored reactive drills show the player-perspective defender. Off, or no WebGL: word/arrow cues, recorded as the fallback.' },
  { key: 'liveOnsetDetector', label: 'Live feint onset detector', detail: 'The camera starts the defender when the feint begins. Experimental until validated (part 16 §12 "Feint"); otherwise planned timing, labelled.' },
  { key: 'speechDiagnostic', label: 'Digit diagnostic (speech)', detail: "Experimental. In the optional scanning diagnostic, Chrome listens for the numbers she calls (Chrome sends the audio to Google's speech service). Its count is only a starting estimate on the result card; you confirm it. Never needed to play." },
  { key: 'notifications', label: 'Notifications', detail: 'Send one small session record per finished session (plan/14). Not built yet.' },
  { key: 'ballTracking', label: 'Ball tracking', detail: 'Use the registered ball profile in after-block analysis (part 17). Experimental until validated.' },
  { key: 'coneDetection', label: 'Cone detection', detail: 'Experimental. In Room profiles, finds orange cones in the room photo and moves the suggested markers onto them; you check and confirm every position.' },
  { key: 'neuralBallDetector', label: 'Ball detector model', detail: "Experimental. Adds MediaPipe's object detector (EfficientDet-Lite0, Apache-2.0, downloaded from Google once) to ball tracking. Run Parent → Balls → detector speed test first; results stay estimates until validated." },
  { key: 'learning', label: 'Personalisation', detail: 'Collect verified examples and propose personalised models that must beat the frozen validation set (part 18).' },
];

export function FeaturesCard() {
  const { settings } = useData();
  const cap = settings.capabilities;
  return (
    <div className="card stack">
      <h2>Features</h2>
      {FLAG_TEXT.map((f) => (
        <label key={f.key} className="check" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" aria-label={f.label} checked={settings.flags[f.key]} onChange={(e) => db.settings.update('main', { flags: { ...settings.flags, [f.key]: e.target.checked } })} />
          <span>
            <strong>{f.label}</strong> <span className="muted">{f.detail}</span>
          </span>
        </label>
      ))}
      <p className="muted">
        This Chromebook: {cap ? (cap.webgl ? `WebGL ${cap.webgl2 ? '2' : '1'} available (${cap.renderer ?? 'unknown renderer'})` : 'no WebGL, the 3D defender falls back to word/arrow cues') : 'not checked yet'}
        {cap?.defenderFps ? ` · 3D defender measured at ${cap.defenderFps} fps` : ' · 3D defender frame rate not measured yet (Parent → 3D defender test)'}.
      </p>
    </div>
  );
}
