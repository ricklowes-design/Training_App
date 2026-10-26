import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { logHistory, useData } from '../../app/data';
import { rgbToHsv, type Hsv } from '../../ball/colour';
import { detectBall, sizeModel, type Detection } from '../../ball/detect';
import { captureAt, sufficiency, type Capture } from '../../ball/register';
import { listCameras, openStream, preferredCamera } from '../../camera/session';
import { db } from '../../db/db';
import { newWorker, playFrames, wasmBase } from '../../analysis/run';
import type { FromWorker } from '../../analysis/worker';
import type { BallProfile } from '../../db/types';
import { fmtDate, Seg } from '../../ui/widgets';
import { BallCheck } from './BallCheck';

// Parent → Balls (task 6.2, part 17 BR-01): register a ball, switch between balls, recalibrate.

const KIND_TEXT: Record<Capture['kind'], string> = {
  stationary: 'Ball still on the floor',
  rotating: 'Ball rolling slowly',
  toward: 'Ball near the camera',
  away: 'Ball far from the camera',
};
const CW = 320;

function Register({ onDone, name0 }: { onDone: () => void; name0: string }) {
  const { settings } = useData();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState('');
  const [kind, setKind] = useState<Capture['kind']>('stationary');
  const [caps, setCaps] = useState<Capture[]>([]);
  const [bg, setBg] = useState<Hsv[]>([]);
  const [msg, setMsg] = useState('');
  const [name, setName] = useState(name0);
  const [live, setLive] = useState<Detection | null>(null);
  const suff = caps.length ? sufficiency(caps, bg) : null;

  useEffect(() => {
    let s: MediaStream | null = null;
    let stop = false;
    (async () => {
      try {
        const cam = preferredCamera(await listCameras(), settings.camera.deviceId);
        s = await openStream(cam?.deviceId);
        if (stop) return s.getTracks().forEach((t) => t.stop());
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      stop = true;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [settings.camera.deviceId]);

  // Live feedback: where the current colour model finds the ball.
  useEffect(() => {
    if (!suff) return;
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const t = setInterval(() => {
      const v = video.current;
      if (!v || v.readyState < 2) return;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0, 160, 90);
      const d = detectBall(ctx.getImageData(0, 0, 160, 90).data, 160, 90, suff.colour, sizeModel(caps.map((x) => ({ y: x.y, diameterPx: x.diameterPx })), CW));
      setLive(d[0] ?? null);
    }, 250);
    return () => clearInterval(t);
  }, [suff?.colour.h, suff?.colour.s, caps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function grab(): ImageData | null {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c || v.readyState < 2) return null;
    c.width = CW;
    c.height = Math.round((CW * v.videoHeight) / v.videoWidth) || 180;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  function onTap(e: React.MouseEvent<HTMLVideoElement>) {
    const img = grab();
    if (!img) return;
    const r = e.currentTarget.getBoundingClientRect();
    const tx = Math.round(((e.clientX - r.left) / r.width) * (img.width - 1));
    const ty = Math.round(((e.clientY - r.top) / r.height) * (img.height - 1));
    const c = captureAt(img.data, img.width, img.height, tx, ty, kind);
    if (!c) return setMsg('That did not look like a ball: tap the middle of the ball, in good light.');
    // Background: a spread of pixels away from the ball.
    const bgPx: Hsv[] = [];
    for (let i = 0; i < 1500; i++) {
      const x = Math.floor(Math.random() * img.width);
      const y = Math.floor(Math.random() * img.height);
      if (Math.hypot(x - tx, y - ty) < c.diameterPx * 1.5) continue;
      const k = 4 * (y * img.width + x);
      bgPx.push(rgbToHsv(img.data[k], img.data[k + 1], img.data[k + 2]));
    }
    setCaps([...caps, c]);
    setBg([...bg, ...bgPx]);
    setMsg(`Captured: ${KIND_TEXT[kind].toLowerCase()} (${c.diameterPx} px across).`);
  }

  async function save() {
    if (!suff?.ok) return;
    const id = `ball-${Date.now().toString(36)}`;
    const p: BallProfile = {
      id,
      name: name.trim() || 'Ball',
      createdAt: new Date().toISOString(),
      colour: suff.colour,
      sizeSamples: caps.map((c) => ({ y: c.y, diameterPx: c.diameterPx })),
      frameWidth: CW,
      backgroundMatchShare: suff.backgroundMatchShare,
      captureKinds: [...new Set(caps.map((c) => c.kind))],
      negatives: bg.length,
      sampleCount: caps.length,
      sufficiency: 'sufficient',
      active: true,
    };
    await db.transaction('rw', db.ballProfiles, db.settings, async () => {
      for (const b of await db.ballProfiles.toArray()) if (b.active) await db.ballProfiles.update(b.id, { active: false });
      await db.ballProfiles.put(p);
      await db.settings.update('main', { activeBallProfileId: id });
    });
    await logHistory('parent', 'ball registered', `${p.name}: ${p.sampleCount} captures, background match ${Math.round(p.backgroundMatchShare * 100)}%`);
    onDone();
  }

  if (err) return <div className="error-box">Camera could not start: {err}</div>;
  return (
    <div className="stack">
      <div className="grid2">
        <div style={{ position: 'relative' }}>
          <video ref={video} muted playsInline onClick={onTap} style={{ width: '100%', borderRadius: 12, background: '#000', cursor: 'crosshair' }} data-testid="ball-video" />
          {live ? (
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              <circle cx={live.x} cy={live.y} r={Math.max(0.02, live.diameter)} fill="none" stroke="#3ddc84" strokeWidth={0.006} />
            </svg>
          ) : null}
          <canvas ref={canvas} style={{ display: 'none' }} />
        </div>
        <div className="stack">
          <label className="field">
            <span>Ball name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Seg value={kind} onChange={setKind} options={(Object.keys(KIND_TEXT) as Capture['kind'][]).map((k) => ({ value: k, label: KIND_TEXT[k] }))} />
          <p>Set the ball as described, then tap the middle of the ball in the picture. Six or more taps, of at least three kinds, in the usual light.</p>
          <p className="muted">
            {caps.length} capture(s){suff ? ` · background match ${Math.round(suff.backgroundMatchShare * 100)}%` : ''}
            {live ? ` · live: found (confidence ${live.confidence})` : suff ? ' · live: not found' : ''}
          </p>
          {suff && !suff.ok ? <p className="pill warn">{suff.reasons.join('; ')}</p> : null}
          {msg ? <div className="note-box">{msg}</div> : null}
          <div className="row">
            <button className="btn" onClick={() => (setCaps([]), setBg([]), setMsg(''))}>
              Start again
            </button>
            <button className="btn primary" disabled={!suff?.ok} onClick={save}>
              Save ball
            </button>
            <button className="btn" onClick={onDone}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Speed of the experimental ball detector model on this Chromebook (part 17 task 6.1), from a recorded clip. */
function DetectorSpeedTest() {
  const { settings } = useData();
  const clips = useLiveQuery(() => db.clips.orderBy('date').reverse().limit(10).toArray(), []);
  const [clipId, setClipId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const cap = settings.capabilities;
  async function run() {
    const source: Blob | undefined = file ?? clips?.find((c) => c.id === clipId)?.blob;
    if (!source) return;
    setBusy(true);
    try {
      setStatus('Extracting frames…');
      const bitmaps: ImageBitmap[] = [];
      await playFrames(source, 30, 1, (_t, bmp) => (bitmaps.push(bmp), true), 60);
      setStatus(`Running the detector on ${bitmaps.length} frames (the first run downloads the model)…`);
      const w = newWorker();
      const out = await new Promise<FromWorker>((resolve) => {
        w.onmessage = (ev: MessageEvent<FromWorker>) => resolve(ev.data);
        w.postMessage({ type: 'benchBall', wasmBase: wasmBase(), bitmaps, fps: 30 }, bitmaps);
      });
      w.terminate();
      if (out.type === 'error') throw new Error(out.message);
      if (out.type !== 'benchBall') throw new Error('unexpected reply');
      const at = new Date().toISOString();
      await db.settings.update('main', { capabilities: { ...(cap ?? { checkedAt: at, webgl: false, webgl2: false }), ballDetectorFps: out.fps, ballDetectorDelegate: out.delegate, ballDetectorAt: at } });
      await logHistory('parent', 'ball detector speed', `${out.fps} fps (${out.delegate}), ball found in ${out.detected} of ${out.frames} frames`);
      setStatus(`${out.fps} fps on the ${out.delegate} delegate; a ball was found in ${out.detected} of ${out.frames} frames. Analysis runs after the block, so below about 8 fps it only takes longer.`);
    } catch (e) {
      setStatus(`Test failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card stack">
      <h3>Detector model speed test (experimental)</h3>
      <p className="muted">
        Measures how fast the optional detector model (EfficientDet-Lite0, Apache-2.0) runs on this Chromebook. Use a clip with the ball in view. Needs Wi-Fi the first time.
      </p>
      <div className="row">
        <label className="btn">
          Choose a video file
          <input type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => (setFile(e.target.files?.[0] ?? null), setClipId(''))} />
        </label>
        <select value={clipId} onChange={(e) => (setClipId(e.target.value), setFile(null))} style={{ maxWidth: 320 }}>
          <option value="">a recorded clip…</option>
          {(clips ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {fmtDate(c.date)} {c.blockLabel}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={busy || (!file && !clipId)} onClick={run}>
          Run the detector test
        </button>
      </div>
      {status ? <div className="note-box">{status}</div> : null}
      <p className="muted">
        Last result: {cap?.ballDetectorFps ? `${cap.ballDetectorFps} fps (${cap.ballDetectorDelegate}), ${fmtDate(cap.ballDetectorAt!)}` : 'not measured'} · model in ball tracking:{' '}
        {settings.flags.neuralBallDetector ? 'on' : 'off (Settings → Features → Ball detector model)'}
      </p>
    </div>
  );
}

export function BallsSection() {
  const { settings } = useData();
  const balls = useLiveQuery(() => db.ballProfiles.toArray(), []);
  const [reg, setReg] = useState<string | null>(null);
  // Open on the ball check until it has been done once.
  const [checking, setChecking] = useState(!settings.ballCheck || !!settings.ballCheck.skipped);
  if (reg !== null) return <Register name0={reg} onDone={() => setReg(null)} />;
  return (
    <div className="stack">
      {checking ? (
        <BallCheck onRegister={(name) => (setChecking(false), setReg(name))} onClose={() => setChecking(false)} />
      ) : (
        <div className="card row spread">
          <span>
            Ball check:{' '}
            {settings.ballCheck && !settings.ballCheck.skipped
              ? `${fmtDate(settings.ballCheck.date)}, ${settings.ballCheck.recommended ? `${settings.ballCheck.recommended} recommended` : 'no ball stood out'}`
              : 'not done'}
          </span>
          <button className="btn small" onClick={() => setChecking(true)}>
            Compare the balls you have
          </button>
        </div>
      )}
      <div className="card stack">
        <p>
          A registered ball lets the after-block analysis follow the ball: gate crossings and observable touches. Its numbers stay estimates, and never move a stage, until checked in Parent → Validation (part 17).
          Turn it on in Settings → Features → Ball tracking.
        </p>
        <ul className="clean">
          {(balls ?? []).map((b) => (
            <li key={b.id} className="row spread">
              <span>
                <strong>{b.name}</strong> · {fmtDate(b.createdAt)} · {b.sampleCount} captures · background match {Math.round(b.backgroundMatchShare * 100)}%{b.id === settings.activeBallProfileId ? ' · in use' : ''}
              </span>
              <span className="row">
                {b.id !== settings.activeBallProfileId ? (
                  <button
                    className="btn small"
                    onClick={async () => {
                      await db.settings.update('main', { activeBallProfileId: b.id });
                      await logHistory('parent', 'ball', `Using ${b.name}`);
                    }}
                  >
                    Use this ball
                  </button>
                ) : null}
                <button className="btn small" onClick={() => setReg(b.name)}>
                  Recalibrate
                </button>
                <button className="btn small" onClick={() => db.ballProfiles.delete(b.id)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="row">
          <button className="btn primary" onClick={() => setReg(`Ball ${(balls?.length ?? 0) + 1}`)}>
            Register new ball
          </button>
        </div>
      </div>
      <DetectorSpeedTest />
    </div>
  );
}
