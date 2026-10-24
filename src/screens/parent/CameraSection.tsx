import { useEffect, useMemo, useRef, useState } from 'react';
import { logHistory, useData } from '../../app/data';
import { applyH, calibrationCones, FAMILY_ZONES, homography } from '../../camera/geometry';
import { captureFrame, listCameras, openStream, preferredCamera } from '../../camera/session';
import { db } from '../../db/db';
import type { CameraSetup, DrillFamily, Pt } from '../../db/types';
import { fmtDate, Seg, Stepper } from '../../ui/widgets';

const FAMILIES: { id: DrillFamily; name: string; where: string }[] = [
  { id: 'L2', name: 'Feinting (L2 feint lane)', where: 'In front, beside the screen, about 1.5 m high, angled down the lane.' },
  { id: 'L1', name: 'Dribbling (L1 slalom)', where: 'In front, elevated, as for feinting.' },
  { id: 'L3', name: 'Scanning and receiving (L3 receive box)', where: 'In front of her, low, 2–3 m away; the screen is behind her.' },
  { id: 'L4', name: 'Ball control (L4 mastery square)', where: 'Front-on, low.' },
];

function useStream(deviceId: string | undefined) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let s: MediaStream | null = null;
    let cancelled = false;
    openStream(deviceId)
      .then((st) => {
        if (cancelled) st.getTracks().forEach((t) => t.stop());
        else {
          s = st;
          setStream(st);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);
  return { stream, error };
}

function Live({ stream, videoRef }: { stream: MediaStream | null; videoRef?: React.RefObject<HTMLVideoElement> }) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? own;
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      void ref.current.play();
    }
  }, [stream, ref]);
  return <video ref={ref} muted playsInline style={{ width: '100%', borderRadius: 12, background: '#000' }} />;
}

/** A photo you can tap: draws the points and polygons given, reports taps as 0..1 picture coordinates. */
function TapPhoto({ url, points, polygons, onTap }: { url: string; points: Pt[]; polygons: { poly: Pt[]; label: string; colour: string }[]; onTap?: (p: Pt) => void }) {
  return (
    <div style={{ position: 'relative', width: '100%', alignSelf: 'start' }}>
      <img
        src={url}
        alt="Reference photo"
        style={{ width: '100%', display: 'block', borderRadius: 12, cursor: onTap ? 'crosshair' : 'default' }}
        onClick={(e) => {
          if (!onTap) return;
          const r = (e.target as HTMLImageElement).getBoundingClientRect();
          onTap({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
        }}
      />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {polygons.map((p, i) => (
          <polygon key={i} points={p.poly.map((q) => `${q.x},${q.y}`).join(' ')} fill={p.colour} fillOpacity={0.25} stroke={p.colour} strokeWidth={0.004} />
        ))}
        {points.map((q, i) => (
          <circle key={i} cx={q.x} cy={q.y} r={0.008} fill="#ffd23f" stroke="#000" strokeWidth={0.002} />
        ))}
      </svg>
    </div>
  );
}

const COLOURS = ['#3ddc84', '#5cb8ff', '#ff5c5c', '#ffb020', '#c9a0ff'];

function Wizard({ family, deviceId, deviceLabel, onDone }: { family: DrillFamily; deviceId: string; deviceLabel: string; onDone: () => void }) {
  const { layout } = useData();
  const { stream, error } = useStream(deviceId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState<{ blob: Blob; width: number; height: number; url: string } | null>(null);
  const cones = useMemo(() => (layout ? calibrationCones(family, layout.derived) : []), [family, layout]);
  const [conePts, setConePts] = useState<Pt[]>([]);
  const spec = FAMILY_ZONES[family];
  const zoneNames = [...spec.zones, ...(spec.tripwire ? ['tripwire'] : [])];
  const [zones, setZones] = useState<Pt[][]>(zoneNames.map(() => []));
  const [zoneIdx, setZoneIdx] = useState(0);
  const [mirror, setMirror] = useState(false);
  const [check, setCheck] = useState<{ p: Pt; floor: [number, number] } | null>(null);
  const [msg, setMsg] = useState('');

  const h = useMemo(() => (conePts.length === 4 ? homography(conePts.map((p) => [p.x, p.y]), cones.map((c) => c.floor)) : null), [conePts, cones]);
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);

  if (!layout) return <p>Set up the room first.</p>;
  if (error) return <div className="error-box">Camera could not start: {error}</div>;

  const polys = zones.map((poly, i) => ({ poly, label: zoneNames[i], colour: COLOURS[i % COLOURS.length] }));

  async function save() {
    if (!photo) return;
    const setup: CameraSetup = {
      drillFamily: family,
      deviceId,
      deviceLabel,
      referenceFrame: photo.blob,
      width: photo.width,
      height: photo.height,
      zones: spec.zones.map((name, i) => ({ name, polygon: zones[i] })),
      tripwire: spec.tripwire ? zones[zoneNames.length - 1] : undefined,
      floorPoints: cones.map((c, i) => ({ name: c.name, img: conePts[i], floor: c.floor })),
      homography: h ?? undefined,
      mirror,
      createdAt: new Date().toISOString(),
    };
    const now = new Date().toISOString();
    await db.transaction('rw', db.cameraSetups, async () => {
      const old = await db.cameraSetups.where('drillFamily').equals(family).toArray();
      for (const o of old) if (!o.retiredAt) await db.cameraSetups.update(o.id!, { retiredAt: now });
      await db.cameraSetups.add(setup);
    });
    await logHistory('parent', 'camera set-up', `${family}: ${zoneNames.length} zones, ${h ? 'floor calibrated' : 'no floor calibration'}, ${mirror ? 'mirrored' : 'not mirrored'}`);
    onDone();
  }

  return (
    <div className="stack">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{FAMILIES.find((f) => f.id === family)?.name}</h2>
        <span className="muted">Step {step + 1} of 4</span>
      </div>
      {step === 0 && (
        <div className="grid2">
          <Live stream={stream} videoRef={videoRef} />
          <div className="stack">
            <p>{FAMILIES.find((f) => f.id === family)?.where}</p>
            <p>Set out the cones for {family} as on the set-up card. Keep the lane empty, then take the reference photo. Every session's framing check compares against it.</p>
            <button
              className="btn primary"
              disabled={!stream}
              onClick={async () => {
                if (!videoRef.current) return;
                const f = await captureFrame(videoRef.current);
                setPhoto({ ...f, url: URL.createObjectURL(f.blob) });
                setStep(1);
              }}
            >
              Take reference photo
            </button>
          </div>
        </div>
      )}
      {step === 1 && photo && (
        <div className="grid2">
          <TapPhoto
            url={photo.url}
            points={check ? [...conePts, check.p] : conePts}
            polygons={[]}
            onTap={(p) => {
              if (conePts.length < 4) setConePts([...conePts, p]);
              else if (h) setCheck({ p, floor: applyH(h, [p.x, p.y]) });
            }}
          />
          <div className="stack">
            <p>Tap the four cones in this order. The app uses them to turn the picture into metres on the floor.</p>
            <ol>
              {cones.map((c, i) => (
                <li key={c.name} style={{ fontWeight: i === conePts.length ? 800 : 400 }}>
                  {c.name} ({c.floor[0]} m, {c.floor[1]} m) {conePts[i] ? '✔' : ''}
                </li>
              ))}
            </ol>
            {conePts.length === 4 && !h ? <p className="error-box">These four points do not make a usable mapping (three in a line?). Clear and tap again.</p> : null}
            {h ? <p className="muted">Check: place a cone at a measured spot and tap it. {check ? `It reads ${check.floor[0].toFixed(2)} m across, ${check.floor[1].toFixed(2)} m along.` : ''}</p> : null}
            <div className="row">
              <button className="btn" onClick={() => (setConePts([]), setCheck(null))}>
                Clear
              </button>
              <button className="btn primary" disabled={!h} onClick={() => setStep(2)}>
                Next: zones
              </button>
            </div>
          </div>
        </div>
      )}
      {step === 2 && photo && (
        <div className="grid2">
          <TapPhoto url={photo.url} points={zones[zoneIdx]} polygons={polys} onTap={(p) => setZones(zones.map((z, i) => (i === zoneIdx && z.length < 4 ? [...z, p] : z)))} />
          <div className="stack">
            <p>Tap the four corners of each zone, going round the edge.</p>
            <ul className="clean">
              {zoneNames.map((z, i) => (
                <li key={z} className="row spread" style={{ fontWeight: i === zoneIdx ? 800 : 400 }}>
                  <span style={{ color: COLOURS[i % COLOURS.length] }}>
                    ■ {z}
                    {z === 'tripwire' ? ' (a strip across the lane about 1 m before the feint cone)' : i === 0 ? ' (where she works; used for the presence rule)' : ''}
                  </span>
                  <span>
                    {zones[i].length}/4{' '}
                    <button className="btn small" onClick={() => (setZoneIdx(i), setZones(zones.map((q, j) => (j === i ? [] : q))))}>
                      Redo
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="btn" disabled={zoneIdx === 0} onClick={() => setZoneIdx(zoneIdx - 1)}>
                Previous zone
              </button>
              {zoneIdx < zoneNames.length - 1 ? (
                <button className="btn primary" disabled={zones[zoneIdx].length < 4} onClick={() => setZoneIdx(zoneIdx + 1)}>
                  Next zone
                </button>
              ) : (
                <button className="btn primary" disabled={zones.some((z) => z.length < 4)} onClick={() => setStep(3)}>
                  Next: mirror check
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="grid2">
          <Live stream={stream} />
          <div className="stack">
            <p>Mirror check: stand in the lane facing the camera and raise your LEFT hand.</p>
            <Seg
              value={mirror ? 'mirror' : 'normal'}
              onChange={(v) => setMirror(v === 'mirror')}
              options={[
                { value: 'normal', label: 'My raised hand shows on the RIGHT of the picture' },
                { value: 'mirror', label: 'It shows on the LEFT (mirrored)' },
              ]}
            />
            {msg ? <p className="muted">{msg}</p> : null}
            <div className="row">
              <button className="btn" onClick={() => setStep(2)}>
                Back
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setMsg('Saving…');
                  void save();
                }}
              >
                Save camera set-up
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CameraSection() {
  const { settings, cameraSetups } = useData();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState('');
  const [wizard, setWizard] = useState<DrillFamily | null>(null);
  const cam = settings.camera;

  useEffect(() => {
    // Labels only appear after permission: open the camera briefly once.
    (async () => {
      try {
        const s = await openStream();
        s.getTracks().forEach((t) => t.stop());
        setDevices(await listCameras());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);
  const chosen = preferredCamera(devices, cam.deviceId);
  const save = (patch: Partial<typeof cam>) => db.settings.update('main', { camera: { ...cam, ...patch } });

  if (wizard && chosen) {
    return (
      <div className="stack">
        <button className="btn small" onClick={() => setWizard(null)}>
          Cancel set-up
        </button>
        <Wizard family={wizard} deviceId={chosen.deviceId} deviceLabel={chosen.label} onDone={() => setWizard(null)} />
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="card stack">
        <label className="check">
          <input type="checkbox" checked={cam.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
          Camera on: record each drill block, check the framing during the demo, use the tripwire for cues (needs a set-up below)
        </label>
        {error ? <div className="error-box">Camera: {error}. Chrome must be allowed to use the camera for this site.</div> : null}
        <label className="field" style={{ maxWidth: 520 }}>
          <span>Camera (the USB webcam is chosen by default)</span>
          <select value={chosen?.deviceId ?? ''} onChange={(e) => save({ deviceId: e.target.value })}>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Camera'}
              </option>
            ))}
          </select>
        </label>
        <Stepper label="Keep clips (days)" value={cam.retentionDays} min={7} max={120} step={1} onChange={(retentionDays) => save({ retentionDays })} />
      </div>
      {FAMILIES.map((f) => {
        const s = cameraSetups.filter((x) => x.drillFamily === f.id && !x.retiredAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        return (
          <div key={f.id} className="card row spread">
            <div>
              <h3 style={{ margin: 0 }}>{f.name}</h3>
              <span className="muted">
                {s ? `Set up ${fmtDate(s.createdAt)} · ${s.zones.length} zones${s.tripwire ? ' + tripwire' : ''} · ${s.homography ? 'floor calibrated' : 'no floor calibration'} · ${s.deviceLabel}` : 'Not set up'}
              </span>
            </div>
            <button className="btn primary" disabled={!chosen} onClick={() => setWizard(f.id)}>
              {s ? 'Redo set-up' : 'Set up'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
