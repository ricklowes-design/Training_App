import { useEffect, useState } from 'react';
import { useData } from '../../app/data';
import { renderTopDown } from '../../camera/topDown';
import type { FloorMapPoint, RoomProfile } from '../../db/types';
import { fitError, fitHomography, type P2 } from '../../domain/homography';
import { CORNERS, landmarkFloor, refPoint } from '../../domain/landmarks';
import { effectiveDims } from '../../domain/room';
import { fmtLen } from '../../domain/units';
import { LayoutDiagram } from '../../ui/LayoutDiagram';

// Photo → top-down floor map (parent request 2026-10-26). The parent taps where known floor points
// (corners of the clear floor, the measured fixed points) are on the room photo; a floor → photo
// mapping is fitted from them and the photo is redrawn from above under the cone plans.

const PX_PER_M = 80;

/** An object URL for the profile's top-down floor picture, while mounted. */
export function useFloorImage(profile: Pick<RoomProfile, 'floorMap'> | undefined): string | undefined {
  const blob = profile?.floorMap?.image;
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    // An old, broken restore stored the image as {}: never crash a session over it.
    if (!(blob instanceof Blob)) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function FloorMapStep({ profile, photoUrl, onChange }: { profile: RoomProfile; photoUrl: string; onChange: (p: RoomProfile) => void }) {
  const { settings, programme } = useData();
  const units = settings.units ?? 'metric';
  const dims = effectiveDims(profile);
  const marks = profile.landmarks ?? [];
  const refs = [...CORNERS.map((c) => `corner:${c}`), ...marks.map((m) => m.id)];
  const [points, setPoints] = useState<FloorMapPoint[]>(profile.floorMap?.points ?? []);
  const [next, setNext] = useState(refs.find((r) => !points.some((p) => p.ref === r)) ?? refs[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const floorImage = useFloorImage(profile);
  const label = (ref: string) => refPoint(ref, marks, dims.length, dims.width)?.label ?? ref;

  if (!photoUrl) return <p className="muted">No photo: take the room photo first (previous step). The floor map is optional.</p>;

  function tap(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const img = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    const updated = [...points.filter((p) => p.ref !== next), { ref: next, img }];
    setPoints(updated);
    setMsg('');
    const after = refs.find((x) => !updated.some((p) => p.ref === x));
    if (after) setNext(after);
  }

  async function make() {
    const usable = points.map((p) => ({ p, rp: refPoint(p.ref, marks, dims.length, dims.width) })).filter((x) => x.rp);
    const floor: P2[] = usable.map((x) => x.rp!.floor);
    const img: P2[] = usable.map((x) => [x.p.img.x, x.p.img.y]);
    const h = fitHomography(floor, img);
    if (!h) return setMsg('These points cannot make a map: use at least four, and not all along one wall.');
    setBusy(true);
    try {
      const err = fitError(h, floor, img);
      const blob = await (await fetch(photoUrl)).blob();
      const image = await renderTopDown(blob, h, dims.length, dims.width, PX_PER_M);
      onChange({ ...profile, floorMap: { points, image, pxPerM: PX_PER_M, fitErrorM: Math.round(err * 100) / 100, createdAt: new Date().toISOString() } });
      setMsg(
        err <= 0.15
          ? `Map made. The points agree to about ${fmtLen(Math.max(0.05, err), units)}.`
          : err <= 0.35
            ? `Map made, roughly: the points agree to about ${fmtLen(err, units)}. Fine for placing cones by eye.`
            : `The points disagree by about ${fmtLen(err, units)}: one is probably in the wrong place or a measurement is off. Check them and try again.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p>
        Optional: tap where each known point <strong>meets the floor</strong> in the photo. The two back corners are usually easiest; then add the fixed points you measured on the sides. Four points are
        needed, five or more are better. The app then redraws the photo from above under every cone plan.
      </p>
      {profile.spaceSource !== 'approxDims' ? <p className="pill warn">The map uses the room's measurements: measure the room in the Size step first for a true-to-size map.</p> : null}
      <div className="grid2">
        <div style={{ position: 'relative', cursor: 'crosshair' }} onClick={tap} data-testid="floor-map-photo">
          <img src={photoUrl} alt="Room photo" draggable={false} style={{ width: '100%', display: 'block', borderRadius: 12, userSelect: 'none' }} />
          {points.map((p, i) => (
            <span
              key={p.ref}
              aria-label={label(p.ref)}
              style={{ position: 'absolute', left: `${p.img.x * 100}%`, top: `${p.img.y * 100}%`, transform: 'translate(-50%,-50%)', width: 22, height: 22, borderRadius: 11, background: '#c49bff', color: '#000', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #000', pointerEvents: 'none' }}
            >
              {i + 1}
            </span>
          ))}
        </div>
        <div className="stack">
          <label className="row">
            <span className="muted">Next tap is the</span>
            <select value={next} onChange={(e) => setNext(e.target.value)} aria-label="Point to place">
              {refs.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                  {points.some((p) => p.ref === r) ? ' (placed)' : ''}
                </option>
              ))}
            </select>
          </label>
          <ol>
            {points.map((p) => (
              <li key={p.ref}>
                {label(p.ref)}{' '}
                <button className="btn small" onClick={() => setPoints(points.filter((x) => x.ref !== p.ref))}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <div className="row">
            <button className="btn primary" disabled={points.length < 4 || busy} onClick={make}>
              {busy ? 'Making the map…' : 'Make the top-down map'}
            </button>
            {profile.floorMap ? (
              <button className="btn" onClick={() => (onChange({ ...profile, floorMap: undefined }), setPoints([]), setMsg(''))}>
                Remove the map
              </button>
            ) : null}
          </div>
          {msg ? <div className="note-box">{msg}</div> : null}
          {floorImage ? (
            <LayoutDiagram
              layoutId="ROOM"
              roomOnly
              d={{ slalomSpacingM: 1, slalomFirstConeM: 0.8, slalomStopZoneM: 1, feintConeM: 3, feintGateAtM: 4.2, feintGateWidthM: 0.8, feintStopZoneM: 0.8, receiveBoxSideM: 1.5, receiveGateWidthM: 1, masterySquareM: 1 }}
              lengthM={dims.length}
              widthM={dims.width}
              floor={profile.floor}
              units={units}
              screenBehindM={programme.layoutGeometry.receiveBox.cueScreenBehindM}
              landmarks={marks.map((m) => ({ label: m.label, floor: landmarkFloor(m, dims.length, dims.width) }))}
              floorImage={floorImage}
              maxHeight={320}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
