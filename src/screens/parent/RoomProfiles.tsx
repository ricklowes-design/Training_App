import { useEffect, useMemo, useRef, useState } from 'react';
import { logHistory, useData } from '../../app/data';
import { saveRoomProfile, useRoomProfile } from '../../app/room';
import { ROOM_H, ROOM_W } from '../../camera/roomCheck';
import { captureFrame, grayAt, listCameras, openStream, preferredCamera, cameraErrorText } from '../../camera/session';
import { db } from '../../db/db';
import type { LayoutInstance, Pt, RoomAnchor, RoomProfile, UsableSpaceClass } from '../../db/types';
import { layoutSummary } from '../../domain/layout';
import { CLASS_DIMS, effectiveDims, layoutCones, layoutFit, newProfile, profileClass, roomInputFor, scaledLayout, suggestPoint } from '../../domain/room';
import { fmtDate, Seg } from '../../ui/widgets';
import { LayoutDiagram, LayoutLegend } from '../../ui/LayoutDiagram';
import { fmtLen, localiseText, type Units } from '../../domain/units';
import { landmarkFloor } from '../../domain/landmarks';
import { MeasureRoom } from './RoomMeasure';
import { FloorMapStep } from './FloorMap';
import { SpaceWizard, type WizardStep } from '../space/SpaceWizard';
import type { ColourModel } from '../../ball/colour';
import { assignCones, colourAt, findCones, ORANGE } from '../../camera/cones';

/** The saved room photo as pixels, 320 px wide (enough for cones, quick to scan). */
async function photoPixels(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = Math.round((320 * bmp.height) / bmp.width);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

// Room profile onboarding (task 1.2, part 15 D1): no tape, no measuring. The parent picks a
// size or draws the safe floor on a camera photo, labels a few stable anchors, and drags the
// suggested cones to where they really are. Everything here is optional except the size.

const ANCHOR_LABELS = ['Desk corner', 'Bookcase edge', 'Door frame', 'Wall corner', 'Sofa corner', 'Window edge'];

/** Size, floor and wall; shows the drill layouts this space allows and the ones it refuses. */
/** Metres or feet and inches; stored once in settings and used everywhere lengths are shown. */
export function UnitsChoice() {
  const { settings } = useData();
  return (
    <div className="row">
      <span className="muted">Lengths in</span>
      <Seg
        value={settings.units ?? 'metric'}
        onChange={(units) => db.settings.update('main', { units })}
        options={[
          { value: 'metric', label: 'Metres' },
          { value: 'imperial', label: 'Feet and inches' },
        ]}
      />
    </div>
  );
}

export function RoomBasicsForm({ profile, onChange, cones, showLayouts = true, sizeOnly }: { profile: RoomProfile; onChange: (p: RoomProfile) => void; cones: number; showLayouts?: boolean; sizeOnly?: boolean }) {
  const { programme, settings } = useData();
  const units: Units = settings.units ?? 'metric';
  const g = programme.layoutGeometry;
  const derived = scaledLayout(roomInputFor({ ...profile, usableSpaceClass: profileClass(profile) }, cones), g);
  const summary = layoutSummary(derived, units);
  const dims = effectiveDims(profile);
  const hasPolygon = profile.safePolygonNormalized.length >= 3;
  return (
    <div className="stack">
      <p className="muted">Measure once with a tape (recommended), or pick the size that looks right if there is no tape. The drills scale to it, and each drill shows where its cones go when it starts.</p>
      <UnitsChoice />
      <div className="row" style={sizeOnly ? { display: 'none' } : undefined}>
        <span className="muted">Space from</span>
        <Seg
          value={profile.spaceSource}
          onChange={(spaceSource) => onChange({ ...profile, spaceSource, measured: spaceSource === 'approxDims', approxUsableM: spaceSource === 'approxDims' ? (profile.approxUsableM ?? { length: dims.length, width: dims.width }) : profile.approxUsableM })}
          options={[
            { value: 'approxDims', label: 'Measure it' },
            { value: 'parentClass', label: 'No tape: pick a size' },
            ...(hasPolygon ? [{ value: 'polygon' as const, label: 'The safe floor on the photo' }] : []),
          ]}
        />
      </div>
      {profile.spaceSource === 'parentClass' ? (
        <div className="stack">
          {(Object.keys(CLASS_DIMS) as UsableSpaceClass[]).map((c) => (
            <label key={c} className="check">
              <input type="radio" name="space" checked={profile.usableSpaceClass === c} onChange={() => onChange({ ...profile, usableSpaceClass: c })} />
              {localiseText(CLASS_DIMS[c].text, units)}
            </label>
          ))}
        </div>
      ) : null}
      {profile.spaceSource === 'approxDims' ? <MeasureRoom profile={profile} onChange={onChange} units={units} /> : null}
      {profile.spaceSource === 'polygon' ? <p>From the photo: about {fmtLen(dims.length, units)} × {fmtLen(dims.width, units)} of clear floor (approximate).</p> : null}
      <div className="row">
        <span className="muted">Floor</span>
        <Seg
          value={profile.floor}
          onChange={(floor) => onChange({ ...profile, floor })}
          options={[
            { value: 'hard', label: 'Hard' },
            { value: 'carpet', label: 'Carpet' },
            { value: 'rubber', label: 'Rubber mat' },
          ]}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={profile.wallUsable} onChange={(e) => onChange({ ...profile, wallUsable: e.target.checked })} />
        A wall can be used for passing and rebounds (household agrees, wall is bare)
      </label>
      {showLayouts ? (
      <details className="card tight stack">
        <summary>
          <strong>Drill layouts in this space ({profileClass(profile)}, {cones} cones)</strong> <span className="muted">· each drill also shows its own when it starts</span>
        </summary>
        <p className="muted">Seen from above: the Chromebook stands at the front wall; the player starts at the back. Each plan changes as you change the size, the number of cones or the units.</p>
        <div className="layout-grid">
          {Object.entries(summary).map(([id, text]) => {
            const fit = layoutFit(id, derived, g, cones);
            return (
              <div key={id} className="stack" style={{ gap: 6 }}>
                <strong>
                  {id} {programme.layouts[id]?.name}
                </strong>
                <LayoutDiagram layoutId={id} d={derived} lengthM={dims.length} widthM={dims.width} floor={profile.floor} units={units} screenBehindM={g.receiveBox.cueScreenBehindM} unavailable={fit.ok ? undefined : fit.reason} maxHeight={360} landmarks={(profile.landmarks ?? []).map((l) => ({ label: l.label, floor: landmarkFloor(l, dims.length, dims.width) }))} />
                <span className={fit.ok ? '' : 'muted'}>{fit.ok ? text : `Not available here: ${localiseText(fit.reason ?? '', units)}. Drills on this layout are not offered.`}</span>
              </div>
            );
          })}
        </div>
        <LayoutLegend />
        <p className="muted">Distances are approximate; place cones by eye. No speed is ever shown in metres per second.</p>
      </details>
      ) : null}
    </div>
  );
}

/** A photo with points and polygons; taps report picture coordinates, and points can be dragged. */
function PhotoBoard({
  url,
  points,
  polygon,
  onTap,
  onDrag,
  labels,
}: {
  url: string;
  points: Pt[];
  polygon?: Pt[];
  onTap?: (p: Pt) => void;
  onDrag?: (i: number, p: Pt) => void;
  labels?: string[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const at = (e: React.PointerEvent): Pt => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  return (
    <div
      ref={box}
      data-testid="room-photo"
      style={{ position: 'relative', width: '100%', alignSelf: 'start', touchAction: 'none', cursor: onTap ? 'crosshair' : 'default' }}
      onPointerDown={(e) => {
        const p = at(e);
        if (onDrag) {
          const r = box.current!.getBoundingClientRect();
          const hit = points.findIndex((q) => Math.hypot((q.x - p.x) * r.width, (q.y - p.y) * r.height) < 24);
          if (hit >= 0) {
            dragging.current = hit;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            return;
          }
        }
        onTap?.(p);
      }}
      onPointerMove={(e) => dragging.current !== null && onDrag?.(dragging.current, at(e))}
      onPointerUp={() => (dragging.current = null)}
    >
      <img src={url} alt="Room photo" draggable={false} style={{ width: '100%', display: 'block', borderRadius: 12, userSelect: 'none' }} />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {polygon && polygon.length ? <polygon points={polygon.map((q) => `${q.x},${q.y}`).join(' ')} fill="#3ddc84" fillOpacity={0.2} stroke="#3ddc84" strokeWidth={0.004} /> : null}
        {points.map((q, i) => (
          <circle key={i} cx={q.x} cy={q.y} r={0.012} fill="#ff8a00" stroke="#000" strokeWidth={0.003} />
        ))}
      </svg>
      {labels
        ? points.map((q, i) => (
            // A number on each marker; the names are listed beside the photo, so close markers never collide.
            <span
              key={i}
              aria-label={labels[i]}
              style={{ position: 'absolute', left: `${q.x * 100}%`, top: `${q.y * 100}%`, transform: 'translate(-50%,-50%)', width: 22, height: 22, borderRadius: 11, background: '#ff8a00', color: '#000', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #000', pointerEvents: 'none' }}
            >
              {i + 1}
            </span>
          ))
        : null}
    </div>
  );
}

const STEPS = ['Size', 'Photo', 'Floor map', 'Anchors', 'Safe floor', 'Cones'] as const;

function ProfileEditor({ initial, onDone }: { initial: RoomProfile; onDone: () => void }) {
  const d = useData();
  const { programme: p, settings, layouts } = d;
  const [prof, setProf] = useState<RoomProfile>(initial);
  const [step, setStep] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState('');
  const [anchorLabel, setAnchorLabel] = useState(ANCHOR_LABELS[0]);
  const [layoutId, setLayoutId] = useState('L2');
  const [cones, setCones] = useState<Record<string, Pt[]>>({});
  const [msg, setMsg] = useState('');
  // Experimental cone detection (off by default): the colour to look for, and "tap a cone to teach it".
  const [coneColour, setConeColour] = useState<ColourModel>(ORANGE);
  const [teach, setTeach] = useState(false);

  useEffect(() => {
    if (!prof.backgroundFrame) return setUrl('');
    const u = URL.createObjectURL(prof.backgroundFrame);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [prof.backgroundFrame]);

  // The camera only while on the photo step.
  useEffect(() => {
    if (step !== 1) return;
    let s: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        const devices = await listCameras();
        const cam = preferredCamera(devices, settings.camera.deviceId);
        s = await openStream(cam?.deviceId);
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        setStream(s);
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      } catch (e) {
        setCamError(cameraErrorText(e));
      }
    })();
    return () => {
      cancelled = true;
      s?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [step, settings.camera.deviceId]);

  const g = p.layoutGeometry;
  const input = roomInputFor({ ...prof, usableSpaceClass: profileClass(prof) }, settings.equipment.cones);
  const derived = useMemo(() => scaledLayout(input, g), [input.roomLengthM, input.roomWidthM, g]); // eslint-disable-line react-hooks/exhaustive-deps
  const coneSpec = layoutCones(layoutId, derived, input.roomLengthM);
  const conePts = cones[layoutId] ?? coneSpec.map((c) => suggestPoint(prof.safePolygonNormalized, input.roomLengthM, input.roomWidthM, c.floor));
  const fit = layoutFit(layoutId, derived, g);

  async function takePhoto() {
    if (!video.current) return;
    const f = await captureFrame(video.current);
    const grey = grayAt(video.current, ROOM_W, ROOM_H);
    const devices = await listCameras();
    const cam = preferredCamera(devices, settings.camera.deviceId);
    const label = cam?.label ?? '';
    let h = 0;
    for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    setProf({ ...prof, floorMap: undefined, backgroundFrame: f.blob, backgroundThumb: Array.from(grey.data), cameraFingerprint: { deviceLabelHash: h.toString(16), width: f.width, height: f.height }, deviceId: cam?.deviceId });
    setStep(2);
  }

  async function save(final: RoomProfile) {
    const r = await saveRoomProfile({ ...final, lastVerifiedAt: final.backgroundFrame ? new Date().toISOString() : final.lastVerifiedAt }, p, settings);
    setMsg(`Saved ${r.profile.name} v${r.profile.version}${r.newLayout ? `; drill geometry is now layout v${r.layoutVersion}` : ''}.`);
    setProf(r.profile);
    return r;
  }

  async function confirmCones() {
    const r = await save(prof);
    const lv = r.layoutVersion || (layouts[layouts.length - 1]?.version ?? 1);
    const inst: LayoutInstance = {
      id: `${r.profile.id}:${layoutId}:${lv}`,
      roomProfileId: r.profile.id,
      roomProfileVersion: r.profile.version,
      layoutId,
      layoutVersion: lv,
      createdAt: new Date().toISOString(),
      observedConePositionsNormalized: coneSpec.map((c, i) => ({ name: c.name, pt: conePts[i] })),
      verificationStatus: 'confirmed',
      safeZones: r.profile.safePolygonNormalized.length ? [{ name: 'safe floor', polygon: r.profile.safePolygonNormalized }] : [],
      gateZones: [],
      geometryClass: r.profile.usableSpaceClass,
    };
    await db.layoutInstances.put(inst);
    await db.roomProfiles.update(r.profile.id, { savedLayoutRefs: [...new Set([...r.profile.savedLayoutRefs, inst.id])] });
    await logHistory('parent', 'cone positions', `${r.profile.name}: ${layoutId} confirmed on the photo (layout v${lv})`);
    setMsg(`${layoutId} cone positions confirmed for layout v${lv}.`);
  }

  return (
    <div className="stack">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>
          {prof.name} · {STEPS[step]}
        </h2>
        <span className="muted">
          Step {step + 1} of {STEPS.length}
        </span>
      </div>
      {step === 0 && (
        <div className="card stack">
          <label className="field" style={{ maxWidth: 360 }}>
            <span>Profile name</span>
            <input type="text" value={prof.name} onChange={(e) => setProf({ ...prof, name: e.target.value })} />
          </label>
          <RoomBasicsForm profile={prof} onChange={setProf} cones={settings.equipment.cones} />
        </div>
      )}
      {step === 1 && (
        <div className="grid2">
          {camError ? <div className="error-box">Camera could not start: {camError}. The profile still works without a photo (camera-unverified).</div> : <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 12, background: '#000' }} />}
          <div className="stack">
            <p>Put the webcam where it will stay (about 1.5 m up at the end of the lane). Clear the floor, then take the photo. It is kept on this Chromebook only.</p>
            <label className="check">
              <input type="checkbox" checked={prof.mountConfirmed} onChange={(e) => setProf({ ...prof, mountConfirmed: e.target.checked })} />
              The camera mount is in its usual place
            </label>
            <button className="btn primary" disabled={!stream} onClick={takePhoto}>
              Take room photo
            </button>
            {url ? <img src={url} alt="Saved room photo" style={{ width: '50%', borderRadius: 8 }} /> : null}
          </div>
        </div>
      )}
      {step === 2 && (
        <FloorMapStep profile={prof} photoUrl={url} onChange={setProf} />
      )}
      {step === 3 && (
        <div className="grid2">
          {url ? (
            <PhotoBoard
              url={url}
              points={prof.anchors.map((a) => a.pt)}
              labels={prof.anchors.map((a) => a.label)}
              onTap={(pt) => setProf({ ...prof, anchors: [...prof.anchors, { id: crypto.randomUUID(), label: anchorLabel, pt } satisfies RoomAnchor] })}
            />
          ) : (
            <p className="muted">No photo: anchors need the camera photo. Skip this step for a zero-measurement, camera-unverified profile.</p>
          )}
          <div className="stack">
            <p>Tap 2–4 things that never move (furniture corners, wall junctions, a door frame). At each session start the app looks for them to tell whether the camera moved.</p>
            <label className="field">
              <span>Next anchor is a</span>
              <select value={anchorLabel} onChange={(e) => setAnchorLabel(e.target.value)}>
                {ANCHOR_LABELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <ul className="clean">
              {prof.anchors.map((a, i) => (
                <li key={a.id} className="row spread">
                  {i + 1}. {a.label}
                  <button className="btn small" onClick={() => setProf({ ...prof, anchors: prof.anchors.filter((x) => x.id !== a.id) })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="grid2">
          {url ? (
            <PhotoBoard url={url} points={prof.safePolygonNormalized} polygon={prof.safePolygonNormalized} onTap={(pt) => setProf({ ...prof, safePolygonNormalized: [...prof.safePolygonNormalized, pt], spaceSource: 'polygon' })} />
          ) : (
            <p className="muted">No photo: the size you picked is used.</p>
          )}
          <div className="stack">
            <p>Tap round the floor she can safely use, going round the edge. Leave about half a metre from furniture, radiators and anything breakable. The app never guesses clearance from the picture.</p>
            <p>
              {prof.safePolygonNormalized.length} corners · {prof.safePolygonNormalized.length >= 3 ? `about ${effectiveDims({ ...prof, spaceSource: 'polygon' }).length} × ${effectiveDims({ ...prof, spaceSource: 'polygon' }).width} m (approximate) · ${profileClass({ ...prof, spaceSource: 'polygon' })}` : 'tap at least 3'}
            </p>
            <button className="btn" onClick={() => setProf({ ...prof, safePolygonNormalized: [], spaceSource: prof.spaceSource === 'polygon' ? 'parentClass' : prof.spaceSource })}>
              Clear the safe floor
            </button>
          </div>
        </div>
      )}
      {step === 5 && (
        <div className="grid2">
          {url ? (
            <PhotoBoard
              url={url}
              points={conePts}
              polygon={prof.safePolygonNormalized}
              labels={coneSpec.map((c) => c.name)}
              onDrag={(i, pt) => setCones({ ...cones, [layoutId]: conePts.map((q, j) => (j === i ? pt : q)) })}
              onTap={
                teach
                  ? async (pt) => {
                      const img = await photoPixels(prof.backgroundFrame!);
                      setConeColour(colourAt(img.data, img.width, img.height, pt));
                      setTeach(false);
                      setMsg('Cone colour learned from your tap. Press "Find cones in the photo".');
                    }
                  : undefined
              }
            />
          ) : (
            <p className="muted">No photo: set the cones out from the layout text.</p>
          )}
          <div className="stack">
            <Seg value={layoutId} onChange={setLayoutId} options={['L1', 'L2', 'L3', 'L4'].map((l) => ({ value: l, label: `${l} ${p.layouts[l]?.name ?? ''}` }))} />
            {fit.ok ? (
              <>
                <p>Suggested cone positions for {p.layouts[layoutId]?.name}. They are approximate: drag each to where you put the cone. {layoutSummary(derived, settings.units ?? 'metric')[layoutId]}.</p>
                <ol className="muted" style={{ margin: 0, columns: 2 }}>
                  {coneSpec.map((c) => (
                    <li key={c.name}>{c.name}</li>
                  ))}
                </ol>
                {settings.flags.coneDetection && url ? (
                  <div className="row">
                    <button
                      className="btn"
                      onClick={async () => {
                        const img = await photoPixels(prof.backgroundFrame!);
                        const found = findCones(img.data, img.width, img.height, coneColour, prof.safePolygonNormalized);
                        const match = assignCones(conePts, found.map((f) => f.base));
                        const moved = match.filter(Boolean).length;
                        setCones({ ...cones, [layoutId]: conePts.map((q, i) => match[i] ?? q) });
                        setMsg(
                          `Experimental: found ${found.length} cone-coloured object(s); moved ${moved} of ${conePts.length} markers onto them. Check every marker and drag any that are wrong before confirming.`,
                        );
                      }}
                    >
                      Find cones in the photo
                    </button>
                    <button className="btn small" aria-pressed={teach} onClick={() => setTeach(!teach)}>
                      {teach ? 'Tap a cone in the photo…' : 'Teach cone colour'}
                    </button>
                  </div>
                ) : null}
                <button className="btn primary" onClick={confirmCones}>
                  Confirm {layoutId} positions
                </button>
              </>
            ) : (
              <p className="error-box">Not available in this space: {fit.reason}.</p>
            )}
          </div>
        </div>
      )}
      {msg ? <div className="note-box">{msg}</div> : null}
      <div className="row spread">
        <button className="btn" onClick={() => (step === 0 ? onDone() : setStep(step - 1))}>
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        <div className="row">
          <button className="btn" onClick={async () => (await save(prof), onDone())}>
            Save and close
          </button>
          {step < STEPS.length - 1 ? (
            <button className="btn primary" disabled={!prof.name.trim()} onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The guided measurement for an existing room (the same steps as the first set-up). */
function GuidedMeasure({ initial, onDone }: { initial: RoomProfile; onDone: () => void }) {
  const { programme, settings } = useData();
  const [prof, setProf] = useState<RoomProfile>(initial.spaceSource === 'approxDims' ? initial : { ...initial, spaceSource: 'approxDims', measured: true });
  const [step, setStep] = useState<WizardStep>(initial.space ? 'space' : 'measure');
  return (
    <div className="stack">
      <div className="card stack">
        <label className="field" style={{ maxWidth: 360 }}>
          <span>Room name</span>
          <input type="text" value={prof.name} onChange={(e) => setProf({ ...prof, name: e.target.value })} />
        </label>
        <SpaceWizard profile={prof} onChange={setProf} step={step} setStep={setStep} />
      </div>
      <div className="row spread">
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" disabled={!prof.space || !prof.name.trim()} onClick={async () => (await saveRoomProfile(prof, programme, settings), onDone())}>
          Save and use this room
        </button>
      </div>
    </div>
  );
}

export function RoomProfilesSection() {
  const { roomProfiles, settings, programme, layouts, layout } = useData();
  const [editing, setEditing] = useState<RoomProfile | null>(null);
  const [guided, setGuided] = useState<RoomProfile | null>(null);
  if (editing) return <ProfileEditor initial={editing} onDone={() => setEditing(null)} />;
  if (guided) return <GuidedMeasure initial={guided} onDone={() => setGuided(null)} />;
  const active = settings.activeRoomProfileId;
  return (
    <div className="stack">
      <div className="card stack">
        <p>
          Room profiles hold the measurements, the camera photo and what the drills are placed against. "Measure (guided)" walks through measuring the room, the photo from the Chromebook and the
          things in it. Current drill geometry: layout v{layout?.version ?? '—'}.
        </p>
        <ul className="clean">
          {roomProfiles
            .filter((r) => !r.retiredAt)
            .map((r) => (
              <li key={r.id} className="row spread">
                <span>
                  <strong>{r.name}</strong> v{r.version} · {r.usableSpaceClass} · {r.backgroundFrame ? `photo, ${r.anchors.length} anchors` : 'no photo (camera-unverified)'}
                  {r.safePolygonNormalized.length >= 3 ? ' · safe floor drawn' : ''}
                  {r.id === active ? ' · in use' : ''}
                  <label className="check" style={{ marginTop: 6 }}>
                    <input type="checkbox" checked={r.wallUsable} aria-label={`${r.name}: back wall can be used`} onChange={(e) => void saveRoomProfile({ ...r, wallUsable: e.target.checked }, programme, settings)} />
                    Back wall can be used (kick the ball against it in wall drills)
                  </label>
                </span>
                <span className="row">
                  {r.id !== active ? (
                    <button className="btn small" onClick={() => useRoomProfile(r.id, programme, settings)}>
                      Use this room
                    </button>
                  ) : null}
                  <button className="btn small primary" onClick={() => setGuided(r)}>
                    Measure (guided)
                  </button>
                  <button className="btn small" onClick={() => setEditing(r)}>
                    Edit
                  </button>
                </span>
              </li>
            ))}
        </ul>
        <div className="row">
          <button className="btn" onClick={() => setGuided({ ...newProfile(`room-${Date.now().toString(36)}`, `Room ${roomProfiles.length + 1}`, new Date().toISOString()), spaceSource: 'approxDims', measured: true })}>
            New room (guided measurement)
          </button>
          <button className="btn" onClick={() => setEditing(newProfile(`room-${Date.now().toString(36)}`, `Room ${roomProfiles.length + 1}`, new Date().toISOString()))}>
            New room (no tape: pick a size)
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Layout versions</h3>
        <ul className="clean">
          {[...layouts].reverse().map((l) => (
            <li key={l.version}>
              v{l.version} · {fmtDate(l.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })} · {roomProfiles.find((r) => r.id === (l.roomProfileId ?? 'room-1'))?.name ?? 'room'} · about {l.roomLengthM} × {l.roomWidthM} m · {l.floor} · slalom{' '}
              {l.derived.slalomCones ?? 5} cones {l.derived.slalomSpacingM} m apart
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
