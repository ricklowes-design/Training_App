import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { logHistory, useData } from '../../app/data';
import { newWorker, playFrames, wasmBase } from '../../analysis/run';
import type { FromWorker } from '../../analysis/worker';
import { db } from '../../db/db';
import type { Clip } from '../../db/types';
import { downloadBlob } from '../../ui/download';
import { fmtDate } from '../../ui/widgets';
import { Scorecard } from '../../analysis/Scorecard';
import { DefenderReplay } from '../../defender/Replay';
import { RepReview } from './RepReview';

/** Task 14 policy: ≥ 20 fps analyse at native rate; 8–20 at 15 fps; < 8 pose waits for v3. */
export function posePolicy(liteFps?: number, fullFps?: number): { pose: 'off' | 'lite' | 'full'; analysisFps: number; text: string } {
  if ((fullFps ?? 0) >= 20) return { pose: 'full', analysisFps: 30, text: `Full model at ${fullFps} fps: analyse at the native 30 fps.` };
  if ((liteFps ?? 0) >= 20) return { pose: 'lite', analysisFps: 30, text: `Lite model at ${liteFps} fps: analyse at the native 30 fps with the lite model.` };
  const best = Math.max(liteFps ?? 0, fullFps ?? 0);
  if (best >= 8) {
    const model = (fullFps ?? 0) >= 8 && (fullFps ?? 0) >= (liteFps ?? 0) * 0.9 ? 'full' : 'lite';
    return { pose: model, analysisFps: 15, text: `Best ${best} fps: analyse at 15 fps with the ${model} model.` };
  }
  return { pose: 'off', analysisFps: 30, text: `Best ${best} fps (< 8): pose features wait for v3; zone and motion features carry milestone 2.` };
}

const BENCH_FRAMES = 90;

export function PoseTestSection() {
  const { settings } = useData();
  const clips = useLiveQuery(() => db.clips.orderBy('date').reverse().limit(10).toArray(), []);
  const [file, setFile] = useState<File | null>(null);
  const [clipId, setClipId] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const test = settings.camera.poseTest;

  async function run() {
    const source: Blob | undefined = file ?? clips?.find((c) => c.id === clipId)?.blob;
    if (!source) return;
    setBusy(true);
    try {
      setStatus('Extracting frames…');
      const bitmaps: ImageBitmap[] = [];
      await playFrames(source, 30, 1, (_t, bmp) => (bitmaps.push(bmp), true), BENCH_FRAMES);
      const fps: Record<string, number> = {};
      let delegate = '';
      for (const model of ['lite', 'full'] as const) {
        setStatus(`Running the ${model} model on ${bitmaps.length} frames (first run downloads the model)…`);
        const copies = await Promise.all(bitmaps.map((b) => createImageBitmap(b)));
        const w = newWorker();
        const out = await new Promise<FromWorker>((resolve) => {
          w.onmessage = (ev: MessageEvent<FromWorker>) => resolve(ev.data);
          w.postMessage({ type: 'bench', model, wasmBase: wasmBase(), bitmaps: copies, fps: 30 }, copies);
        });
        w.terminate();
        if (out.type === 'bench') {
          fps[model] = out.fps;
          delegate = out.delegate;
        } else if (out.type === 'error') throw new Error(out.message);
      }
      bitmaps.forEach((b) => b.close());
      const policy = posePolicy(fps.lite, fps.full);
      await db.settings.update('main', {
        camera: {
          ...settings.camera,
          pose: policy.pose,
          analysisFps: policy.analysisFps,
          poseTest: { date: new Date().toISOString(), liteFps: fps.lite, fullFps: fps.full, delegate, frames: bitmaps.length, source: file ? file.name : 'recorded clip' },
        },
      });
      await logHistory('parent', 'pose speed test', `lite ${fps.lite} fps, full ${fps.full} fps (${delegate}): ${policy.text}`);
      setStatus(policy.text);
    } catch (e) {
      setStatus(`Test failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <p>
          Measures how fast the pose model runs on this Chromebook (task 14). Use a 1080p/30 clip recorded from the USB webcam (the Chromebook's Camera app can record one), or a clip the app
          recorded. Needs Wi-Fi the first time (the models download from Google).
        </p>
        <div className="row">
          <label className="btn">
            Choose a video file
            <input type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => (setFile(e.target.files?.[0] ?? null), setClipId(''))} />
          </label>
          <span className="muted">{file?.name ?? 'or'}</span>
          <select value={clipId} onChange={(e) => (setClipId(e.target.value), setFile(null))} style={{ maxWidth: 360 }}>
            <option value="">a recorded clip…</option>
            {(clips ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {fmtDate(c.date)} {c.blockLabel} ({Math.round(c.durationS)} s)
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={busy || (!file && !clipId)} onClick={run}>
            Run the test
          </button>
        </div>
        {status ? <div className="note-box">{status}</div> : null}
      </div>
      <div className="card">
        <h3>Current setting</h3>
        <p>
          Pose: <strong>{settings.camera.pose}</strong> · analysis at {settings.camera.analysisFps} fps
        </p>
        {test ? (
          <p className="muted">
            Last test {fmtDate(test.date)}: lite {test.liteFps ?? '—'} fps, full {test.fullFps ?? '—'} fps, {test.delegate} delegate, {test.frames} frames from {test.source}.
          </p>
        ) : (
          <p className="muted">Not tested yet: pose is off; zone and motion analysis still run.</p>
        )}
      </div>
    </div>
  );
}

function ClipPlayer({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const { records } = useData();
  const ref = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState('');
  const [rate, setRate] = useState(1);
  const rec = records.find((r) => r.id === clip.sessionRecordId);
  const block = rec?.blocks.find((b) => b.index === clip.blockIndex && b.attempt === clip.attempt);
  const analysis = useLiveQuery(() => db.blockAnalyses.get(clip.id), [clip.id]);
  const reps = useLiveQuery(() => db.repAnalyses.where('clipId').equals(clip.id).sortBy('repIndex'), [clip.id]);
  useEffect(() => {
    const u = URL.createObjectURL(clip.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [clip]);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate, url]);
  const seek = (ms: number) => {
    if (!ref.current) return;
    ref.current.currentTime = Math.max(0, (ms - clip.startActiveMs) / 1000);
  };
  const step = (frames: number) => {
    if (!ref.current) return;
    ref.current.pause();
    ref.current.currentTime = Math.max(0, ref.current.currentTime + frames / 30);
  };
  const live = useLiveQuery(() => db.clips.get(clip.id), [clip.id]);
  const scenarios = useLiveQuery(
    () => db.defenderScenarios.where('sessionRecordId').equals(clip.sessionRecordId).filter((x) => x.blockIndex === clip.blockIndex && (x.attempt ?? 1) === clip.attempt).toArray(),
    [clip.id],
  );
  const [replay, setReplay] = useState<number | null>(null);
  const feintReps = useLiveQuery(() => db.feintReps.where('sessionRecordId').equals(clip.sessionRecordId).toArray(), [clip.id]);
  const keep = live?.keep ?? clip.keep;
  const flagged = analysis?.data.flaggedRepIndexes ?? [];
  return (
    <div className="stack">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>
          {fmtDate(clip.date)} · {clip.blockLabel} · attempt {clip.attempt}
        </h2>
        <button className="btn" onClick={onClose}>
          Back to clips
        </button>
      </div>
      <video ref={ref} src={url} controls playsInline style={{ width: '100%', maxHeight: '60vh', background: '#000', borderRadius: 12 }} />
      <div className="row">
        {[0.25, 0.5, 1].map((r) => (
          <button key={r} className={`btn small ${rate === r ? 'primary' : ''}`} onClick={() => setRate(r)}>
            {r}×
          </button>
        ))}
        <button className="btn small" onClick={() => step(-1)}>
          ◀ frame
        </button>
        <button className="btn small" onClick={() => step(1)}>
          frame ▶
        </button>
        <label className="check">
          <input type="checkbox" checked={!!keep} onChange={(e) => db.clips.update(clip.id, { keep: e.target.checked })} />
          Keep beyond the retention period
        </label>
        <button className="btn small" onClick={() => downloadBlob(clip.blob, `clip-${clip.date.slice(0, 10)}-${clip.blockLabel}.webm`)}>
          Save to Downloads
        </button>
      </div>
      {flagged.length ? (
        <div className="card tight row">
          <strong>Flagged reps to review (10 s each):</strong>
          {flagged.map((i) => {
            const cue = block?.cueLog?.find((e) => e.rep === i);
            return (
              <button
                key={i}
                className="btn small"
                onClick={() => {
                  seek((cue?.cueMs ?? cue?.repStartMs ?? 0) - 3000);
                  setRate(0.5);
                  void ref.current?.play();
                  const stopAt = ((cue?.cueMs ?? cue?.repStartMs ?? 0) + 7000 - clip.startActiveMs) / 1000;
                  const v = ref.current;
                  if (v) {
                    const h = () => {
                      if (v.currentTime >= stopAt) {
                        v.pause();
                        v.removeEventListener('timeupdate', h);
                      }
                    };
                    v.addEventListener('timeupdate', h);
                  }
                }}
              >
                Rep {i + 1}
              </button>
            );
          })}
        </div>
      ) : null}
      {flagged.length && reps?.length ? (
        <div className="stack">
          {flagged.map((i) => {
            const r = reps.find((x) => x.repIndex === i)?.data;
            const sc = scenarios?.find((x) => x.repIndex === i);
            return r ? <RepReview key={i} clip={clip} rep={r} feint={sc ? feintReps?.find((f) => f.scenarioId === sc.id) : undefined} /> : null;
          })}
        </div>
      ) : null}
      {block?.defender && scenarios?.length ? (
        <div className="card stack">
          <strong>
            Defender replays ({block.defender.view === 'player3d' ? '3D' : '2D fallback'}, {block.defender.archetype}; flagged reps only)
          </strong>
          {replay !== null && scenarios.find((x) => x.repIndex === replay) ? (
            <DefenderReplay scenario={scenarios.find((x) => x.repIndex === replay)!} clipUrl={url} startActiveMs={clip.startActiveMs} onClose={() => setReplay(null)} />
          ) : flagged.length ? (
            <div className="row">
              {flagged.map((i) => (
                <button key={i} className="btn small" onClick={() => setReplay(i)}>
                  Replay rep {i + 1} with the defender
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No reps flagged for review in this block.</p>
          )}
        </div>
      ) : null}
      {analysis ? <Scorecard analysis={analysis.data} reps={(reps ?? []).map((r) => r.data)} /> : <p className="muted">No camera analysis for this clip (only cue blocks are analysed).</p>}
      {block?.cueLog?.length ? (
        <div className="card">
          <h3>Key frames (cue times)</h3>
          <div className="row">
            {block.cueLog.map((e) =>
              e.cueMs !== undefined ? (
                <button key={e.rep} className="btn small" onClick={() => seek(e.cueMs!)}>
                  {e.rep + 1}: {e.value}
                  {e.catchType ? ` (${e.catchType})` : ''} @ {(e.cueMs / 1000).toFixed(1)} s
                </button>
              ) : (
                <span key={e.rep} className="pill">
                  {e.rep + 1}: {e.missedTripwire ? 'tripwire missed' : 'no cue (catch)'}
                </span>
              ),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ClipsSection() {
  const { settings } = useData();
  const clips = useLiveQuery(() => db.clips.orderBy('date').reverse().toArray(), []);
  const [open, setOpen] = useState<Clip | null>(null);
  if (open) return <ClipPlayer clip={open} onClose={() => setOpen(null)} />;
  const totalMb = Math.round((clips ?? []).reduce((a, c) => a + c.blob.size, 0) / 1e6);
  return (
    <div className="card">
      <p className="muted">
        {clips?.length ?? 0} clips, {totalMb} MB. Clips older than {settings.camera.retentionDays} days are deleted unless kept. Clips never leave this Chromebook unless you save one.
      </p>
      <ul className="clean">
        {(clips ?? []).map((c) => (
          <li key={c.id} className="row spread">
            <span>
              {fmtDate(c.date, { day: 'numeric', month: 'short', year: '2-digit' })} · {c.blockLabel} · attempt {c.attempt} · {Math.round(c.durationS)} s · {Math.round(c.blob.size / 1e6)} MB
              {c.keep ? ' · kept' : ''}
            </span>
            <div className="row">
              <button className="btn small" onClick={() => setOpen(c)}>
                Open
              </button>
              <button className="btn small" onClick={() => db.clips.delete(c.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Timing budget (task 3.1): camera frame rate, dropped frames, render rate and the camera-to-page delay,
 *  measured on this Chromebook before any millisecond threshold is trusted. */
export function TimingBudgetSection() {
  const { settings } = useData();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const tb = settings.timingBudget;
  async function run() {
    setBusy(true);
    setStatus('Measuring for 10 seconds… keep this screen in front.');
    let stream: MediaStream | null = null;
    try {
      const { openStream, listCameras, preferredCamera } = await import('../../camera/session');
      const cam = preferredCamera(await listCameras(), settings.camera.deviceId);
      stream = await openStream(cam?.deviceId);
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      await v.play();
      const delays: number[] = [];
      let frames = 0;
      let first = -1;
      let last = -1;
      let rafCount = 0;
      const rafGaps: number[] = [];
      let lastRaf = performance.now();
      const end = performance.now() + 10_000;
      await new Promise<void>((resolve) => {
        const onFrame = (now: number, meta: VideoFrameCallbackMetadata) => {
          frames++;
          if (first < 0) first = meta.presentedFrames;
          last = meta.presentedFrames;
          if (meta.captureTime !== undefined) delays.push(meta.expectedDisplayTime - meta.captureTime);
          if (now < end) v.requestVideoFrameCallback(onFrame);
          else resolve();
        };
        v.requestVideoFrameCallback(onFrame);
        const raf = (t: number) => {
          rafCount++;
          rafGaps.push(t - lastRaf);
          lastRaf = t;
          if (t < end) requestAnimationFrame(raf);
        };
        requestAnimationFrame(raf);
      });
      const cameraFps = Math.round(frames / 10);
      const presented = last - first + 1;
      const droppedFramePct = presented > 0 ? Math.round((100 * Math.max(0, presented - frames)) / presented) : 0;
      const sorted = [...delays].sort((a, b) => a - b);
      const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
      const spread = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] - sorted[Math.floor(sorted.length * 0.1)] : undefined;
      const gaps = [...rafGaps].sort((a, b) => a - b);
      const budget = {
        measuredAt: new Date().toISOString(),
        cameraFps,
        droppedFramePct,
        renderFps: Math.round(rafCount / 10),
        captureToPageMs: med !== undefined ? Math.round(med) : undefined,
        alignmentErrorMs: spread !== undefined ? Math.round(spread / 2 + 1000 / Math.max(1, cameraFps) / 2) : undefined,
        cueDisplayMs: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : undefined,
      };
      await db.settings.update('main', { timingBudget: budget });
      await logHistory('parent', 'timing budget', JSON.stringify(budget));
      setStatus('Saved.');
    } catch (e) {
      setStatus(`Could not measure: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="card stack">
        <p>
          Measures the camera and screen timing on this Chromebook (task 3.1). Run it with the webcam in its usual place. The alignment error is used as the timing uncertainty shown with every camera time.
        </p>
        <button className="btn primary" disabled={busy} onClick={run}>
          Measure the timing budget
        </button>
        {status ? <div className="note-box">{status}</div> : null}
      </div>
      <div className="card">
        <h3>Last measurement</h3>
        {tb ? (
          <ul className="clean">
            <li>Measured {fmtDate(tb.measuredAt)}</li>
            <li>Camera: {tb.cameraFps} fps, {tb.droppedFramePct}% frames dropped</li>
            <li>Screen: {tb.renderFps ?? '—'} fps; a cue change shows within about {tb.cueDisplayMs ?? '—'} ms</li>
            <li>Camera to page: {tb.captureToPageMs ?? 'not reported by this camera'} ms; alignment error ± {tb.alignmentErrorMs ?? '—'} ms</li>
            <li>3D defender: {settings.capabilities?.defenderFps ? `${settings.capabilities.defenderFps} fps` : 'not measured (Parent → 3D defender test)'}</li>
          </ul>
        ) : (
          <p className="muted">Not measured yet. Camera times use ± one frame plus 33 ms until it is.</p>
        )}
      </div>
    </div>
  );
}
