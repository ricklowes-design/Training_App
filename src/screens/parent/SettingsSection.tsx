import { configured, paused, sendText } from '../../app/notify';
import { tryFill } from '../../domain/templates';
import { useEffect, useState } from 'react';
import { listVoices, say, setSoundSettings, tone, unlockAudio } from '../../audio/audio';
import { logHistory, useData } from '../../app/data';
import { hashPin, validPin } from '../../app/pin';
import { db } from '../../db/db';
import type { Settings } from '../../db/types';
import { Seg, Stepper } from '../../ui/widgets';
import { UnitsChoice } from './RoomProfiles';
import { localDate } from '../../domain/dates';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function SettingsSection() {
  const { settings, programme } = useData();
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
    setSoundSettings(sound, programme.voiceStyles);
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
          <input type="checkbox" checked={settings.talkThrough !== false} onChange={(e) => save({ talkThrough: e.target.checked })} />
          Read each drill's instructions out before it starts
        </label>
        {(settings.talkThroughSkip ?? []).length ? (
          <div className="row">
            <span className="muted">Not read out (the player knows them): {(settings.talkThroughSkip ?? []).join(', ')}</span>
            <button className="btn small" onClick={() => save({ talkThroughSkip: [] })}>
              Read them all out again
            </button>
          </div>
        ) : null}
        <label className="check">
          <input type="checkbox" checked={settings.sound.wallMic !== false} onChange={(e) => saveSound({ wallMic: e.target.checked })} />
          Wall drills: the word shows when the ball hits the wall (uses the microphone to hear the bang; nothing is recorded or sent)
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.sound.endOfSessionLine} onChange={(e) => saveSound({ endOfSessionLine: e.target.checked })} />
          Speak the end-of-session line
        </label>
        <Stepper label="Volume %" value={Math.round(settings.sound.volume * 100)} min={10} max={100} step={10} onChange={(v) => saveSound({ volume: v / 100 })} />
        <Stepper label="Voice speed %" value={Math.round(settings.sound.voiceRate * 100)} min={50} max={150} step={5} onChange={(v) => saveSound({ voiceRate: v / 100 })} />
        <label className="field">
          <span>Voice style</span>
          <select
            value={settings.sound.voiceStyle ?? ''}
            aria-label="Voice style"
            onChange={(e) => {
              const voiceStyle = e.target.value || undefined;
              // The touchline coach sounds best with a British voice: pick one when no voice was chosen.
              const gb = voiceStyle === 'touchline' && !settings.sound.voiceURI ? voices.find((v) => v.lang === 'en-GB' && /male/i.test(v.name)) ?? voices.find((v) => v.lang === 'en-GB') : undefined;
              void saveSound({ voiceStyle, ...(gb ? { voiceURI: gb.voiceURI } : {}) });
            }}
          >
            <option value="">Standard</option>
            {Object.entries(programme.voiceStyles ?? {}).map(([id, st]) => (
              <option key={id} value={id}>
                {st.name}
              </option>
            ))}
          </select>
        </label>
        {settings.sound.voiceStyle && programme.voiceStyles?.[settings.sound.voiceStyle]?.note ? <p className="muted">{programme.voiceStyles[settings.sound.voiceStyle].note}</p> : null}
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
              setSoundSettings(settings.sound, programme.voiceStyles);
              tone('start');
              say('Slalom close control in 10 seconds. Walk to the start.');
              say('Half way.');
              say('Thirty seconds.');
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

      {settings.flags.notifications ? <NotificationsCard /> : null}

      <div className="card stack">
        <h2>Weekly allocation</h2>
        <p className="muted">How the suggested session shares the week between areas. Equal is the plan's default; the next suggestion is the area furthest below its share, then the one practised least recently.</p>
        {programme.areas.map((ar) => (
          <div key={ar.id} className="row">
            <span style={{ minWidth: 220 }}>{ar.name}</span>
            <Seg
              value={settings.allocation?.[ar.id] ?? 1}
              onChange={(w) => save({ allocation: { ...(settings.allocation ?? {}), [ar.id]: w } })}
              options={[0.5, 1, 2, 3].map((w) => ({ value: w, label: w === 1 ? 'Equal' : w === 0.5 ? 'Half' : `${w}×` }))}
            />
          </div>
        ))}
      </div>

      <div className="card stack">
        <h2>Calendar (next three weeks)</h2>
        <p className="muted">Mark days with a game, a light day or a rest day (for example a tournament, a busy day or a holiday). Light and game days suggest a light session; a rest day plans none. Weekly game days above still apply when a day is left as usual.</p>
        <div className="calendar-grid">
          {Array.from({ length: 21 }, (_, k) => {
            const d = new Date();
            d.setDate(d.getDate() + k);
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const cur = settings.availability?.find((x) => x.date === iso)?.kind ?? '';
            return (
              <label key={iso} className="field">
                <span>{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <select
                  aria-label={`Day ${iso}`}
                  value={cur}
                  onChange={(e) => {
                    const rest = (settings.availability ?? []).filter((x) => x.date !== iso && x.date >= localDate());
                    const kind = e.target.value as '' | 'rest' | 'light' | 'game';
                    save({ availability: kind ? [...rest, { date: iso, kind }].sort((a, b) => a.date.localeCompare(b.date)) : rest });
                  }}
                >
                  <option value="">As usual</option>
                  <option value="light">Light</option>
                  <option value="game">Game</option>
                  <option value="rest">Rest</option>
                </select>
              </label>
            );
          })}
        </div>
      </div>

      <div className="card stack">
        <h2>Screens</h2>
        <UnitsChoice />
        <Stepper label="End-of-drill card: Next after (s)" value={settings.cardAutoAdvanceS} min={5} max={120} step={5} onChange={(cardAutoAdvanceS) => save({ cardAutoAdvanceS })} />
        <Stepper label="Demo view: start block after (s)" value={settings.demoAutoStartS} min={5} max={180} step={5} onChange={(demoAutoStartS) => save({ demoAutoStartS })} />
        <Stepper label="…when the cones need moving (s)" value={settings.coneSetupS ?? 60} min={20} max={300} step={10} onChange={(coneSetupS) => save({ coneSetupS })} />
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
  { key: 'realisticDefender', label: 'Realistic defender movement', detail: 'Experimental. The 3D defender moves with recorded movement of a real person defending (load, lunge, push back) instead of generated poses. Its reactions and scoring are unchanged. Compare both in Parent → 3D defender test first.' },
  { key: 'liveOnsetDetector', label: 'Live feint onset detector', detail: 'The camera starts the defender when the feint begins. Experimental until validated (part 16 §12 "Feint"); otherwise planned timing, labelled.' },
  { key: 'speechDiagnostic', label: 'Digit diagnostic (speech)', detail: "Experimental. In the optional scanning diagnostic, Chrome listens for the numbers the player calls (Chrome sends the audio to Google's speech service). Its count is only a starting estimate on the result card; you confirm it. Never needed to play." },
  { key: 'notifications', label: 'Notifications', detail: 'After each completed session, post one short message to a Discord or Telegram chat you choose (set it up in Settings → Notifications). Only the date, area, session number, status and minutes are sent.' },
  { key: 'ballTracking', label: 'Ball tracking', detail: 'Use the registered ball profile in after-block analysis (part 17). Experimental until validated.' },
  { key: 'coneDetection', label: 'Cone detection', detail: 'Experimental. In Room profiles, finds orange cones in the room photo and moves the suggested markers onto them; you check and confirm every position.' },
  { key: 'neuralBallDetector', label: 'Ball detector model', detail: "Experimental. Adds MediaPipe's object detector (EfficientDet-Lite0, Apache-2.0, downloaded from Google once) to ball tracking. Run Parent → Balls → detector speed test first; results stay estimates until validated." },
  { key: 'rapidTouches', label: 'Rapid touch counting', detail: 'Experimental, needs ball tracking. Estimates the quick taps in the mastery set (inside-outside and outside-only taps) from the ball\'s side-to-side movement, with a range. Never used for progression; nothing is shown when the feet hide the ball too much.' },
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

/** Parent → Settings → Notifications (plan/14): a chat webhook for completion messages; nothing else leaves the device. */
function NotificationsCard() {
  const { settings, programme } = useData();
  const n = settings.notify ?? { channel: 'discord' as const };
  const [msg, setMsg] = useState('');
  const [pauseDays, setPauseDays] = useState(7);
  const [reason, setReason] = useState('rest week');
  const save = (patch: Partial<NonNullable<Settings['notify']>>) => db.settings.update('main', { notify: { ...n, ...patch } });
  const ready = configured(n);
  const sample = `${n.includeName && n.firstName ? `${n.firstName}: ` : ''}${tryFill(programme.feedbackTemplates, 'completed', { area: programme.areas[1]?.name ?? 'Feinting', n: 8, blocks: 4, minutes: 20 }) ?? ''}`;
  return (
    <div className="card stack" data-testid="notifications-card">
      <h2>Notifications</h2>
      <p className="muted">
        When a session is completed (not partial, stopped, a trial or an extra), the Chromebook posts one message to your chat. Only this leaves the device: the date, the area, the session number, the status and the minutes. No results, clips or notes. Reminders need a small scheduled service and are not set up.
      </p>
      <div className="row">
        <span className="muted">Send to</span>
        <Seg value={n.channel} onChange={(channel) => save({ channel })} options={[{ value: 'discord', label: 'Discord channel' }, { value: 'telegram', label: 'Telegram chat' }]} />
      </div>
      {n.channel === 'discord' ? (
        <label className="field">
          <span>Discord webhook URL (channel settings → Integrations → Webhooks → Copy webhook URL)</span>
          <input type="url" id="notify-webhook" value={n.webhookUrl ?? ''} onChange={(e) => save({ webhookUrl: e.target.value.trim() })} placeholder="https://discord.com/api/webhooks/…" />
        </label>
      ) : (
        <div className="grid2">
          <label className="field">
            <span>Telegram bot token (from @BotFather)</span>
            <input id="notify-token" value={n.telegramToken ?? ''} onChange={(e) => save({ telegramToken: e.target.value.trim() })} placeholder="123456:ABC…" />
          </label>
          <label className="field">
            <span>Chat ID (send the bot a message, then look it up)</span>
            <input id="notify-chat" value={n.telegramChatId ?? ''} onChange={(e) => save({ telegramChatId: e.target.value.trim() })} placeholder="123456789" />
          </label>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={!!n.includeName} onChange={(e) => save({ includeName: e.target.checked })} />
        Include the player's first name in the message (off: the message has no name)
      </label>
      {n.includeName ? (
        <label className="field">
          <span>First name for the greeting (the only personal detail sent)</span>
          <input id="notify-name" value={n.firstName ?? ''} onChange={(e) => save({ firstName: e.target.value })} />
        </label>
      ) : null}
      <p>
        Example: <span className="mono">{sample}</span>
      </p>
      <div className="row">
        <button
          className="btn small"
          disabled={!ready}
          onClick={async () => {
            setMsg('Sending…');
            try {
              await sendText(n, tryFill(programme.feedbackTemplates, 'notifyTest', {}) ?? 'Test message.');
              setMsg('Sent. Check the chat.');
            } catch (e) {
              setMsg(`Not sent: ${e instanceof Error ? e.message : 'check the link and the Wi-Fi'}.`);
            }
          }}
        >
          Send a test message
        </button>
        <button className="btn small" onClick={() => save({ webhookUrl: undefined, telegramToken: undefined, telegramChatId: undefined, queue: [] })}>
          Delete the link
        </button>
        <span className="muted">{ready ? msg || (n.queue?.length ? `${n.queue.length} message(s) waiting to be sent.` : '') : 'Not set up yet.'}</span>
      </div>
      <div className="row">
        {paused(n) ? (
          <>
            <span>
              Paused until {n.pausedUntil} ({n.pauseReason}).
            </span>
            <button className="btn small" onClick={() => save({ pausedUntil: undefined, pauseReason: undefined })}>
              Resume
            </button>
          </>
        ) : (
          <>
            <span className="muted">Pause for</span>
            <Seg value={pauseDays} onChange={setPauseDays} options={[3, 7, 14].map((d) => ({ value: d, label: `${d} days` }))} />
            <select aria-label="Pause reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {['rest week', 'holiday', 'injury', 'exams'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <button
              className="btn small"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + pauseDays - 1);
                void save({ pausedUntil: localDate(d), pauseReason: reason });
              }}
            >
              Pause
            </button>
          </>
        )}
      </div>
    </div>
  );
}
