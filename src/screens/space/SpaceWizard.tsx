import { useEffect, useRef, useState } from 'react';
import { useData } from '../../app/data';
import { newWorker, wasmBase } from '../../analysis/run';
import type { FromWorker } from '../../analysis/worker';
import { roomPhotoFields } from '../../camera/roomPhoto';
import { listCameras, openStream, preferredCamera } from '../../camera/session';
import { renderTopDown } from '../../camera/topDown';
import type { ItemPlace, Pt, RoomProfile, Space, SpaceItem } from '../../db/types';
import { fitError, fitHomography, type P2 } from '../../domain/homography';
import { layoutFit, roomInputFor, scaledLayout } from '../../domain/room';
import { guessPlace, photoFloorPairs, questions, spaceRefs, withSpace, workspace } from '../../domain/space';
import { fmtLen, localiseText, type Units } from '../../domain/units';
import { LayoutDiagram } from '../../ui/LayoutDiagram';
import { Seg } from '../../ui/widgets';
import { LengthInput } from '../parent/RoomMeasure';
import { UnitsChoice } from '../parent/RoomProfiles';
import { useFloorImage } from '../parent/FloorMap';

// Guided measurement of the training space (parent request 2026-10-26):
// 1. measure the room; 2. put the Chromebook where it will stand and take a photo;
// 3. "now measure these": the things found in the photo, with what to measure drawn on it;
// 4. the training space worked out from those, and the photo redrawn from above.
// Cones are not shown here: each drill shows its own when it starts.

export type WizardStep = 'measure' | 'photo' | 'items' | 'space';
const ORDER: WizardStep[] = ['measure', 'photo', 'items', 'space'];
const TITLES: Record<WizardStep, string> = {
  measure: "Let's start with measuring your space",
  photo: 'Position the Chromebook and take a photo',
  items: 'Now measure these for me',
  space: 'Your training space',
};
const PLACES: { value: ItemPlace; label: string }[] = [
  { value: 'left', label: 'Against the left wall' },
  { value: 'right', label: 'Against the right wall' },
  { value: 'back', label: 'Against the back wall' },
  { value: 'inRoom', label: 'Standing in the room' },
];
const ROOM_D = { slalomSpacingM: 1, slalomFirstConeM: 0.8, slalomStopZoneM: 1, feintConeM: 3, feintGateAtM: 4.2, feintGateWidthM: 0.8, feintStopZoneM: 0.8, receiveBoxSideM: 1.5, receiveGateWidthM: 1, masterySquareM: 1 };

const emptySpace = (p: RoomProfile): Space => p.space ?? { lengthM: p.approxUsableM?.length ?? 6.1, widthM: p.approxUsableM?.width ?? 3.0, items: [] };

/** The room plan with what has been measured so far. */
function SpacePlan({ profile, space, units }: { profile: RoomProfile; space: Space; units: Units }) {
  const { programme } = useData();
  const ws = workspace(space);
  const floorImage = useFloorImage(profile.floorMap?.covers === 'room' ? profile : undefined);
  const refs = spaceRefs(space).map((r) => ({ label: r.label, floor: [r.at[0] - (ws.x0 + ws.x1) / 2, r.at[1] - ws.y0] as [number, number] }));
  return (
    <LayoutDiagram
      layoutId="ROOM"
      roomOnly
      d={ROOM_D}
      lengthM={ws.lengthM}
      widthM={ws.widthM}
      floor={profile.floor}
      units={units}
      screenBehindM={programme.layoutGeometry.receiveBox.cueScreenBehindM}
      space={space}
      landmarks={refs}
      floorImage={floorImage}
      floorImageCovers="room"
      maxHeight={360}
    />
  );
}

export function SpaceWizard({ profile, onChange, step, setStep, onNoTape }: { profile: RoomProfile; onChange: (p: RoomProfile) => void; step: WizardStep; setStep: (s: WizardStep) => void; onNoTape?: () => void }) {
  const { settings } = useData();
  const units: Units = settings.units ?? 'metric';
  const space = emptySpace(profile);
  const setSpace = (s: Space) => onChange(withSpace(profile, s));
  const i = ORDER.indexOf(step);
  return (
    <div className="stack" data-testid={`space-step-${step}`}>
      <div className="muted">
        Your space · step {i + 1} of {ORDER.length}
      </div>
      <h2 style={{ margin: 0 }}>{TITLES[step]}</h2>
      {step === 'measure' ? <MeasureStep profile={profile} space={space} setSpace={setSpace} onChange={onChange} units={units} onNext={() => setStep('photo')} onNoTape={onNoTape} /> : null}
      {step === 'photo' ? <PhotoStep profile={profile} onChange={onChange} onNext={() => setStep('items')} onBack={() => setStep('measure')} /> : null}
      {step === 'items' ? <ItemsStep profile={profile} space={space} setSpace={setSpace} units={units} onNext={() => setStep('space')} onBack={() => setStep('photo')} /> : null}
      {step === 'space' ? <SpaceStep profile={profile} space={space} onChange={onChange} units={units} onBack={() => setStep('items')} onRestart={() => setStep('measure')} /> : null}
    </div>
  );
}

function MeasureStep({ profile, space, setSpace, onChange, units, onNext, onNoTape }: { profile: RoomProfile; space: Space; setSpace: (s: Space) => void; onChange: (p: RoomProfile) => void; units: Units; onNext: () => void; onNoTape?: () => void }) {
  return (
    <div className="stack">
      <p>
        You need a tape measure, once. Stand at the <strong>back</strong> of the room, where the player will start, facing the wall where the Chromebook will stand (the <strong>front</strong>). Left and right are as
        you face it. Measure wall to wall; furniture comes in the next steps.
      </p>
      <UnitsChoice />
      <div className="grid2">
        <div className="stack">
          <LengthInput label="Room length" units={units} min={2} value={space.lengthM} onChange={(lengthM) => setSpace({ ...space, lengthM })} />
          <span className="muted">From the back wall to the front wall, where the Chromebook will stand.</span>
          <LengthInput label="Room width" units={units} min={1} value={space.widthM} onChange={(widthM) => setSpace({ ...space, widthM })} />
          <span className="muted">From the left wall to the right wall.</span>
          <div className="row">
            <span className="muted">Floor</span>
            <Seg
              value={profile.floor}
              onChange={(floor) => onChange({ ...withSpace(profile, space), floor })}
              options={[
                { value: 'hard', label: 'Hard' },
                { value: 'carpet', label: 'Carpet' },
                { value: 'rubber', label: 'Rubber mat' },
              ]}
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={profile.wallUsable} onChange={(e) => onChange({ ...withSpace(profile, space), wallUsable: e.target.checked })} />A wall can be used for passing and rebounds
          </label>
        </div>
        <SpacePlan profile={profile} space={space} units={units} />
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => (setSpace(space), onNext())}>
          Next: take a photo of the space
        </button>
        {onNoTape ? (
          <button className="btn" onClick={onNoTape}>
            No tape measure? Pick a size instead
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Mean brightness (0–255) of the live picture, from a small copy. */
function brightness(v: HTMLVideoElement): number {
  if (v.readyState < 2 || !v.videoWidth) return 0;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 18;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(v, 0, 0, 32, 18);
  const d = ctx.getImageData(0, 0, 32, 18).data;
  let sum = 0;
  for (let k = 0; k < d.length; k += 4) sum += 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
  return sum / (d.length / 4);
}

/** Below this the picture is black or nearly: the webcam is still starting, covered, or the room is dark. */
const DARK = 28;

function PhotoStep({ profile, onChange, onNext, onBack }: { profile: RoomProfile; onChange: (p: RoomProfile) => void; onNext: () => void; onBack: () => void }) {
  const { settings } = useData();
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const [started, setStarted] = useState(0); // when the stream began playing
  const [level, setLevel] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [taken, setTaken] = useState<{ fields: Awaited<ReturnType<typeof roomPhotoFields>>; url: string } | null>(null);
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
          setStarted(Date.now());
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

  // Webcams show black frames for a moment after starting: the photo waits for a real picture.
  useEffect(() => {
    if (!started) return;
    const t = setInterval(() => {
      if (video.current) setLevel(brightness(video.current));
      setNow(Date.now());
    }, 400);
    return () => clearInterval(t);
  }, [started]);
  useEffect(() => () => (taken ? URL.revokeObjectURL(taken.url) : undefined), [taken]);
  const lit = level >= DARK;
  const waitedLong = started > 0 && !lit && now - started > 6000;

  async function take() {
    if (!video.current || brightness(video.current) < DARK) return;
    const fields = await roomPhotoFields(video.current, settings.camera.deviceId);
    setTaken({ fields, url: URL.createObjectURL(fields.backgroundFrame!) });
  }

  function use() {
    if (!taken) return;
    // A new photo: things found in the old one lose their place on it, and the old map goes.
    const space = profile.space ? { ...profile.space, backCorners: undefined, items: profile.space.items.map((x) => ({ ...x, box: undefined })) } : undefined;
    onChange({ ...profile, ...taken.fields, mountConfirmed: true, floorMap: undefined, ...(space ? { space } : {}) });
    onNext();
  }

  return (
    <div className="stack">
      <ol className="measure-steps">
        <li>
          Put the Chromebook at the <strong>front wall, in the middle</strong>, where it will stand for training.
        </li>
        <li>Raise it to about table height (70–80 cm, about 2½ ft): a table, shelf or a sturdy box.</li>
        <li>
          Tilt the screen until the picture shows the <strong>whole floor up to the back wall</strong>: the bottom of the back wall should sit about a third of the way down the picture.
        </li>
        <li>Pick up loose things (shoes, toys); leave the furniture where it is. Turn the lights on as for training.</li>
      </ol>
      {err ? (
        <div className="error-box">Camera could not start: {err}. You can skip the photo and list what to measure from by hand.</div>
      ) : (
        <div style={{ position: 'relative', maxWidth: 640, display: taken ? 'none' : undefined }}>
          <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 12, background: '#000', display: 'block' }} />
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <line x1={0.02} x2={0.98} y1={0.33} y2={0.33} stroke="#ffd23f" strokeWidth={0.004} strokeDasharray="0.02 0.015" />
          </svg>
          <span style={{ position: 'absolute', left: 8, top: '26%', color: '#ffd23f', fontWeight: 700, fontSize: 14, textShadow: '0 0 3px #000' }}>bottom of the back wall about here</span>
        </div>
      )}
      {taken ? (
        <div className="stack" style={{ maxWidth: 640 }}>
          <img src={taken.url} alt="The photo just taken" style={{ width: '100%', borderRadius: 12, display: 'block' }} data-testid="photo-taken" />
          <p>Can you see the floor up to the back wall, and the furniture along the sides?</p>
        </div>
      ) : null}
      {!err && !taken && waitedLong ? (
        <div className="note-box" data-testid="photo-dark">
          The camera picture is still dark. Check that the webcam isn't covered (some Chromebooks have a privacy slider or a camera switch on the side), that the lights are on, and that no other app or tab
          (Google Meet, the Camera app) is using the webcam.
        </div>
      ) : null}
      <div className="row">
        <button className="btn" onClick={onBack}>
          Back
        </button>
        {taken ? (
          <>
            <button className="btn" onClick={() => setTaken(null)}>
              Retake
            </button>
            <button className="btn primary" onClick={use}>
              Use this photo
            </button>
          </>
        ) : (
          <>
            <button className="btn primary" disabled={!lit} onClick={take}>
              {started && !lit ? 'Waiting for the camera picture…' : 'Take the photo'}
            </button>
            <button className="btn" onClick={onNext}>
              {profile.backgroundFrame ? 'Keep the earlier photo' : 'Skip the photo'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type TapMode = 'add' | 'cornerL' | 'cornerR';

function ItemsStep({ profile, space, setSpace, units, onNext, onBack }: { profile: RoomProfile; space: Space; setSpace: (s: Space) => void; units: Units; onNext: () => void; onBack: () => void }) {
  const [url, setUrl] = useState('');
  const [sel, setSel] = useState<string | null>(space.items[0]?.id ?? null);
  const [mode, setMode] = useState<TapMode>('add');
  const [status, setStatus] = useState('');
  const asked = useRef(false);
  // The latest measurements, for the detector's answer arriving after the parent has started tapping.
  const latest = useRef(space);
  latest.current = space;
  useEffect(() => {
    if (!profile.backgroundFrame) return;
    const u = URL.createObjectURL(profile.backgroundFrame);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [profile.backgroundFrame]);

  // Look for furniture in the photo once (in the worker; the model downloads the first time).
  useEffect(() => {
    if (!profile.backgroundFrame || asked.current || space.items.some((x) => x.source === 'detected')) return;
    asked.current = true;
    setStatus('Looking for furniture in the photo…');
    (async () => {
      const w = newWorker();
      try {
        const bitmap = await createImageBitmap(profile.backgroundFrame!);
        const out = await new Promise<FromWorker>((resolve) => {
          w.onmessage = (ev: MessageEvent<FromWorker>) => resolve(ev.data);
          w.onerror = (e) => resolve({ type: 'error', message: e.message });
          w.postMessage({ type: 'detectRoom', wasmBase: wasmBase(), bitmap }, [bitmap]);
        });
        if (out.type !== 'room') throw new Error(out.type === 'error' ? out.message : 'no answer');
        const found: SpaceItem[] = out.items.map((d) => ({ id: crypto.randomUUID(), label: d.label, place: guessPlace(d.box), box: d.box, source: 'detected' as const }));
        if (found.length) {
          setSpace({ ...latest.current, items: [...found, ...latest.current.items] });
          setSel(found[0].id);
          setStatus(`Found ${found.length}: ${found.map((x) => x.label.toLowerCase()).join(', ')}. Check where each one stands, then measure. Tap the photo to add anything else (a bookcase, door frame, radiator).`);
        } else setStatus('No furniture found automatically. Tap things in the photo that you can measure from: a sofa or bookcase along a wall, a door frame, a radiator.');
      } catch {
        setStatus('Could not look for furniture automatically (it needs Wi-Fi the first time). Tap things in the photo that you can measure from.');
      } finally {
        w.terminate();
      }
    })();
  }, [profile.backgroundFrame]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (id: string, patch: Partial<SpaceItem>) => setSpace({ ...space, items: space.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const add = (box?: SpaceItem['box']) => {
    const it: SpaceItem = { id: crypto.randomUUID(), label: 'Something else', place: box ? guessPlace(box) : 'left', box, source: box ? 'tapped' : 'typed' };
    setSpace({ ...space, items: [...space.items, it] });
    setSel(it.id);
  };

  function tap(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const pt: Pt = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    if (mode === 'cornerL' || mode === 'cornerR') {
      setSpace({ ...space, backCorners: { ...space.backCorners, [mode === 'cornerL' ? 'left' : 'right']: pt } });
      setMode(mode === 'cornerL' && !space.backCorners?.right ? 'cornerR' : 'add');
      return;
    }
    add({ x: pt.x - 0.03, y: pt.y - 0.06, w: 0.06, h: 0.06 });
  }

  const selected = space.items.find((x) => x.id === sel);
  const backY = space.backCorners?.left && space.backCorners?.right ? (space.backCorners.left.y + space.backCorners.right.y) / 2 : 0.33;

  return (
    <div className="stack">
      <p>
        These measurements tell the app where the clear floor is and give every drill something to place cones against. For each thing, the photo shows what to measure: <strong>A</strong> and{' '}
        <strong>B</strong>.
      </p>
      {status ? <div className="note-box" data-testid="detect-status">{status}</div> : null}
      <div className="grid2">
        <div className="stack">
          {url ? (
            <div style={{ position: 'relative', cursor: 'crosshair' }} onClick={tap} data-testid="space-photo">
              <img src={url} alt="Room photo" draggable={false} style={{ width: '100%', display: 'block', borderRadius: 12, userSelect: 'none' }} />
              <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                {space.items
                  .filter((x) => x.box)
                  .map((x) => (
                    <rect key={x.id} x={x.box!.x} y={x.box!.y} width={x.box!.w} height={x.box!.h} fill="none" stroke={x.id === sel ? '#ffd23f' : '#c49bff'} strokeWidth={x.id === sel ? 0.006 : 0.003} />
                  ))}
                {selected?.box ? <Arrows item={selected} backY={backY} /> : null}
                {(['left', 'right'] as const).map((k) =>
                  space.backCorners?.[k] ? <circle key={k} cx={space.backCorners[k]!.x} cy={space.backCorners[k]!.y} r={0.012} fill="#3ddc84" stroke="#000" strokeWidth={0.003} /> : null,
                )}
              </svg>
              {space.items
                .filter((x) => x.box)
                .map((x) => (
                  <span
                    key={x.id}
                    style={{ position: 'absolute', left: `${x.box!.x * 100}%`, top: `${x.box!.y * 100}%`, transform: 'translate(-30%,-60%)', background: x.id === sel ? '#ffd23f' : '#c49bff', color: '#000', borderRadius: 10, padding: '0 6px', fontSize: 12, fontWeight: 800, pointerEvents: 'none' }}
                  >
                    {space.items.indexOf(x) + 1} {x.label}
                  </span>
                ))}
            </div>
          ) : (
            <p className="muted">No photo: add what you can measure from by hand.</p>
          )}
          {url ? (
            <div className="row">
              <span className="muted">Tapping the photo:</span>
              <Seg
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'add', label: 'adds something to measure' },
                  { value: 'cornerL', label: `marks the back-left corner${space.backCorners?.left ? ' ✔' : ''}` },
                  { value: 'cornerR', label: `marks the back-right corner${space.backCorners?.right ? ' ✔' : ''}` },
                ]}
              />
            </div>
          ) : null}
          {url ? <p className="muted">Marking where the back wall meets the floor at the left and right corners lets the app redraw the photo from above.</p> : null}
        </div>
        <div className="stack">
          {space.items.map((x, k) => {
            const [qa, qb] = questions(x);
            return (
              <div key={x.id} className={`card tight stack${x.id === sel ? ' selected' : ''}`} onClick={() => setSel(x.id)} data-testid={`space-item-${k}`}>
                <div className="row">
                  <strong>{k + 1}</strong>
                  <input type="text" value={x.label} aria-label={`Thing ${k + 1} name`} onChange={(e) => update(x.id, { label: e.target.value })} style={{ flex: 1 }} />
                  <button className="btn small" onClick={(e) => (e.stopPropagation(), setSpace({ ...space, items: space.items.filter((y) => y.id !== x.id) }))}>
                    Remove
                  </button>
                </div>
                <select value={x.place} aria-label={`Thing ${k + 1} place`} onChange={(e) => update(x.id, { place: e.target.value as ItemPlace })}>
                  {PLACES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <LengthInput label={`A: ${qa.text}`} units={units} min={0} value={x.a ?? 0} onChange={(a) => update(x.id, { a })} />
                <LengthInput label={`B: ${qb.text}`} units={units} min={0} value={x.b ?? 0} onChange={(b) => update(x.id, { b })} />
              </div>
            );
          })}
          <div>
            <button className="btn small" onClick={() => add()}>
              + Add something to measure from
            </button>
          </div>
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={onBack}>
          Back
        </button>
        <button className="btn primary" onClick={onNext}>
          Next: your training space
        </button>
      </div>
    </div>
  );
}

/** What to measure, drawn on the photo for the selected thing: A and B as arrows. */
function Arrows({ item, backY }: { item: SpaceItem; backY: number }) {
  const b = item.box!;
  const bottom = Math.min(0.99, b.y + b.h);
  const lines: { x1: number; y1: number; x2: number; y2: number; tag: 'A' | 'B' }[] = [];
  switch (item.place) {
    case 'left':
      lines.push({ x1: b.x + b.w, y1: bottom, x2: b.x + b.w, y2: backY, tag: 'A' }, { x1: b.x + b.w, y1: bottom, x2: 0.98, y2: bottom, tag: 'B' });
      break;
    case 'right':
      lines.push({ x1: b.x, y1: bottom, x2: b.x, y2: backY, tag: 'A' }, { x1: b.x, y1: bottom, x2: 0.02, y2: bottom, tag: 'B' });
      break;
    case 'back':
      lines.push({ x1: 0.02, y1: bottom, x2: b.x, y2: bottom, tag: 'A' }, { x1: b.x + b.w / 2, y1: backY, x2: b.x + b.w / 2, y2: bottom, tag: 'B' });
      break;
    case 'inRoom':
      lines.push({ x1: b.x + b.w / 2, y1: bottom, x2: b.x + b.w / 2, y2: backY, tag: 'A' }, { x1: 0.02, y1: bottom, x2: b.x, y2: bottom, tag: 'B' });
      break;
  }
  return (
    <g>
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#ffd23f" />
        </marker>
      </defs>
      {lines.map((l) => (
        <g key={l.tag}>
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#ffd23f" strokeWidth={0.006} markerStart="url(#arrowhead)" markerEnd="url(#arrowhead)" />
          <circle cx={(l.x1 + l.x2) / 2} cy={(l.y1 + l.y2) / 2} r={0.022} fill="#ffd23f" stroke="#000" strokeWidth={0.003} />
          <text x={(l.x1 + l.x2) / 2} y={(l.y1 + l.y2) / 2 + 0.012} fontSize={0.03} textAnchor="middle" fontWeight={800} fill="#000">
            {l.tag}
          </text>
        </g>
      ))}
    </g>
  );
}

function SpaceStep({ profile, space, onChange, units, onBack, onRestart }: { profile: RoomProfile; space: Space; onChange: (p: RoomProfile) => void; units: Units; onBack: () => void; onRestart: () => void }) {
  const { programme, settings } = useData();
  const ws = workspace(space);
  const [mapMsg, setMapMsg] = useState('');
  const L = (m: number) => fmtLen(m, units);
  const pairs = photoFloorPairs(space);
  const key = JSON.stringify([pairs, space.widthM, space.lengthM]);

  // The floor map from the measured points, made once per set of measurements.
  useEffect(() => {
    if (!profile.backgroundFrame || pairs.length < 4) return;
    const floor: P2[] = pairs.map((p) => [p.floor[0] - space.widthM / 2, p.floor[1]]);
    const img: P2[] = pairs.map((p) => p.img);
    const h = fitHomography(floor, img);
    if (!h) return setMapMsg('');
    let cancelled = false;
    (async () => {
      const image = await renderTopDown(profile.backgroundFrame!, h, space.lengthM, space.widthM, 80);
      if (cancelled) return;
      const err = fitError(h, floor, img);
      onChange({ ...withSpace(profile, space), floorMap: { points: [], image, pxPerM: 80, fitErrorM: Math.round(err * 100) / 100, createdAt: new Date().toISOString(), covers: 'room' } });
      setMapMsg(err <= 0.35 ? 'The photo is redrawn from above under the plan.' : `The photo is redrawn from above, roughly: the measurements and the photo disagree by about ${L(err)}. Check the measurements if the picture looks wrong.`);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = scaledLayout(roomInputFor(withSpace(profile, space), settings.equipment.cones), programme.layoutGeometry);
  const refused = ['L1', 'L2', 'L3', 'L4']
    .map((id) => ({ id, fit: layoutFit(id, d, programme.layoutGeometry, settings.equipment.cones) }))
    .filter((x) => !x.fit.ok);
  return (
    <div className="stack" data-testid="training-space">
      <div className="grid2">
        <SpacePlan profile={profile} space={space} units={units} />
        <div className="stack">
          <p style={{ fontSize: '1.2rem' }}>
            Training space: <strong>{L(ws.widthM)} wide × {L(ws.lengthM)} long</strong>
            {ws.limits.length ? ` (the room less ${ws.limits.join(', ')})` : ' (the whole room)'}.
          </p>
          <p>Nothing to set out now: each drill shows where its cones go, measured from these walls and things, when it starts.</p>
          {mapMsg ? <p className="muted">{mapMsg}</p> : pairs.length < 4 && profile.backgroundFrame ? <p className="muted">For a picture from above, mark the two back corners on the photo and measure at least two things from it.</p> : null}
          {refused.length ? (
            <div className="note-box">
              Not possible in this space:{' '}
              {refused.map((r) => `${programme.layouts[r.id]?.name ?? r.id} (${localiseText(r.fit.reason ?? '', units)})`).join('; ')}. Those drills are not offered.
            </div>
          ) : (
            <p className="muted">Every drill layout fits.</p>
          )}
          <div className="row">
            <button className="btn" onClick={onBack}>
              Back
            </button>
            <button className="btn" onClick={onRestart}>
              Measure again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
