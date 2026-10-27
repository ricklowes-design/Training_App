import { useEffect, useRef, useState } from 'react';
import { logHistory, useData } from '../../app/data';
import { rgbToHsv, type Hsv } from '../../ball/colour';
import { rankBalls, type BallResult, type BallTry } from '../../ball/compare';
import { captureAt } from '../../ball/register';
import { listCameras, openStream, preferredCamera } from '../../camera/session';
import { db } from '../../db/db';

// Ball check before the first drills (parent request 2026-10-26): show each ball you have to the
// webcam on the training floor; the app says which one it can tell apart from this room best, and
// that ball is then registered. Nothing is recorded; only the colour numbers are kept.

const CW = 320;
const VERDICT: Record<BallResult['verdict'], string> = { standsOut: 'go', usable: 'info', hard: 'warn', notFound: 'warn' };

export function BallCheck({ onRegister, onClose }: { onRegister: (name: string) => void; onClose?: () => void }) {
  const { settings } = useData();
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const [bg, setBg] = useState<Hsv[]>([]);
  const [tries, setTries] = useState<BallTry[]>([{ name: 'Ball 1', captures: [], misses: 0 }]);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<ReturnType<typeof rankBalls> | null>(null);
  const cur = tries[tries.length - 1];

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

  function grab(): ImageData | null {
    const v = video.current;
    if (!v || v.readyState < 2) return null;
    const c = document.createElement('canvas');
    c.width = CW;
    c.height = Math.round((CW * v.videoHeight) / v.videoWidth) || 180;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  function sampleRoom() {
    const img = grab();
    if (!img) return setMsg('The camera picture is not ready yet; try again in a moment.');
    const px: Hsv[] = [];
    for (let i = 0; i < 4000; i++) {
      const k = 4 * Math.floor(Math.random() * img.width * img.height);
      px.push(rgbToHsv(img.data[k], img.data[k + 1], img.data[k + 2]));
    }
    setBg(px);
    setMsg('Room sampled. Now put the first ball on the floor in view and tap the middle of it.');
  }

  function onTap(e: React.MouseEvent<HTMLVideoElement>) {
    if (!bg.length) return setMsg('First press "Sample the empty floor" with no ball in view.');
    const img = grab();
    if (!img) return;
    const r = e.currentTarget.getBoundingClientRect();
    const tx = Math.round(((e.clientX - r.left) / r.width) * (img.width - 1));
    const ty = Math.round(((e.clientY - r.top) / r.height) * (img.height - 1));
    const c = captureAt(img.data, img.width, img.height, tx, ty, 'stationary');
    const next = c ? { ...cur, captures: [...cur.captures, c] } : { ...cur, misses: cur.misses + 1 };
    setTries([...tries.slice(0, -1), next]);
    setResult(null);
    setMsg(c ? `${cur.name}: found (${next.captures.length} so far). Move it somewhere else in view and tap again, or go to the next ball.` : `${cur.name}: no single colour found there. Tap the middle of the ball, or its main colour.`);
  }

  async function compare() {
    const r = rankBalls(
      tries.filter((t) => t.captures.length || t.misses),
      bg,
    );
    setResult(r);
    const at = new Date().toISOString();
    await db.settings.update('main', { ballCheck: { date: at, recommended: r.recommended, results: r.results.map((x) => ({ name: x.name, verdict: x.verdict, backgroundMatchShare: x.backgroundMatchShare })) } });
    await logHistory('parent', 'ball check', `${r.results.length} balls compared; ${r.recommended ? `recommended ${r.recommended}` : 'none stands out from the room'}`);
  }

  if (err) return <div className="error-box">Camera could not start: {err}. The ball check needs the webcam; drills work without it.</div>;
  return (
    <div className="card stack" data-testid="ball-check">
      <h3 style={{ margin: 0 }}>Which ball works best? (ball check, about 3 minutes)</h3>
      <ol className="measure-steps">
        <li>Point the webcam at the training floor, as for a session, in the usual light.</li>
        <li>With no ball in view, press "Sample the empty floor".</li>
        <li>Put a ball on the floor in view, give it a name (e.g. "Orange size 4"), and tap the middle of it two or three times in different spots.</li>
        <li>"Another ball" for each ball you have, then "Compare".</li>
      </ol>
      <div className="grid2">
        <video ref={video} muted playsInline onClick={onTap} style={{ width: '100%', borderRadius: 12, background: '#000', cursor: 'crosshair' }} data-testid="ball-check-video" />
        <div className="stack">
          <button className={`btn${bg.length ? '' : ' primary'}`} onClick={sampleRoom}>
            {bg.length ? 'Sample the empty floor again' : 'Sample the empty floor'}
          </button>
          <label className="field">
            <span>This ball's name</span>
            <input type="text" value={cur.name} onChange={(e) => setTries([...tries.slice(0, -1), { ...cur, name: e.target.value }])} />
          </label>
          <p className="muted">
            {tries.length} ball{tries.length > 1 ? 's' : ''} · {cur.name}: {cur.captures.length} found{cur.misses ? `, ${cur.misses} missed` : ''}
          </p>
          <div className="row">
            <button className="btn" disabled={!cur.captures.length && !cur.misses} onClick={() => (setTries([...tries, { name: `Ball ${tries.length + 1}`, captures: [], misses: 0 }]), setMsg('Swap in the next ball and tap it.'))}>
              Another ball
            </button>
            <button className="btn primary" disabled={!bg.length || !tries.some((t) => t.captures.length || t.misses)} onClick={compare}>
              Compare
            </button>
            {onClose ? (
              <button className="btn" onClick={onClose}>
                Close
              </button>
            ) : null}
          </div>
          {msg ? <div className="note-box">{msg}</div> : null}
        </div>
      </div>
      {result ? (
        <div className="stack" data-testid="ball-check-result">
          <h3 style={{ margin: 0 }}>{result.recommended ? `Use ${result.recommended}` : 'None of these stands out from this room'}</h3>
          <ul className="clean">
            {result.results.map((r) => (
              <li key={r.name}>
                <span className={`pill ${VERDICT[r.verdict]}`}>{r.name}</span> {r.text}
              </li>
            ))}
          </ul>
          {result.recommended ? (
            <div className="row">
              <button className="btn primary" onClick={() => onRegister(result.recommended!)}>
                Register {result.recommended} for ball tracking
              </button>
              <span className="muted">A short set of taps with the ball still, rolling and near/far, so the camera can follow it.</span>
            </div>
          ) : (
            <p className="muted">A ball that is mostly one bright colour (yellow, orange or lime) different from the floor is easiest. Drills work without ball tracking.</p>
          )}
          <p className="muted">Size is not judged by the camera: use the size the coach or club uses for the player's age group.</p>
        </div>
      ) : null}
    </div>
  );
}
