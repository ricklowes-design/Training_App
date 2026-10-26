import { useData } from '../../app/data';
import type { Landmark, RoomProfile } from '../../db/types';
import { effectiveDims } from '../../domain/room';
import { LANDMARK_SUGGESTIONS, landmarkFloor, SIDE_TEXT } from '../../domain/landmarks';
import { fromFtIn, toFtIn, type Units } from '../../domain/units';
import { LayoutDiagram } from '../../ui/LayoutDiagram';
import { useFloorImage } from './FloorMap';

// Set-up, measured once (parent request 2026-10-26): the clear floor with a tape, and a few fixed
// things around it that cones can be placed against later. Every drill then shows its own cone
// positions against these points when it starts.

/** A length entry in the chosen units; the value is always metres. */
export function LengthInput({ label, value, units, min, onChange }: { label: string; value: number; units: Units; min: number; onChange: (m: number) => void }) {
  if (units === 'metric')
    return (
      <label className="field">
        <span>{label} (m)</span>
        <input type="number" step="0.05" min={min} max="20" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={`${label} metres`} />
      </label>
    );
  const { ft, inch } = toFtIn(value);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="row">
        <label className="row">
          <input type="number" min="0" max="65" style={{ width: 80 }} value={ft} aria-label={`${label} feet`} onChange={(e) => onChange(fromFtIn(Number(e.target.value), inch))} />
          <span>ft</span>
        </label>
        <label className="row">
          <input type="number" min="0" max="11" style={{ width: 70 }} value={inch} aria-label={`${label} inches`} onChange={(e) => onChange(fromFtIn(ft, Math.max(0, Math.min(11, Number(e.target.value)))))} />
          <span>in</span>
        </label>
      </div>
    </div>
  );
}

/** Typing a clear-floor size by hand replaces the guided measurement (and the room-wide floor map). */
const dropGuided = (p: RoomProfile): RoomProfile => ({ ...p, space: undefined, floorMap: p.floorMap?.covers === 'room' ? undefined : p.floorMap });

const SIDES: Landmark['side'][] = ['left', 'right', 'back', 'front'];

/** The clear floor and its fixed reference points, with a live plan of the room. */
export function MeasureRoom({ profile, onChange, units }: { profile: RoomProfile; onChange: (p: RoomProfile) => void; units: Units }) {
  const { programme } = useData();
  const dims = effectiveDims(profile);
  const marks = profile.landmarks ?? [];
  const floorImage = useFloorImage(profile);
  const setMarks = (landmarks: Landmark[]) => onChange({ ...profile, landmarks });
  const update = (id: string, patch: Partial<Landmark>) => setMarks(marks.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const unused = LANDMARK_SUGGESTIONS.filter((l) => !marks.some((m) => m.label === l));
  return (
    <div className="stack">
      {profile.space ? <p className="pill info">Measured with the guided steps (Room profiles → Measure (guided)). Changing the size here replaces those measurements.</p> : null}
      <ol className="measure-steps">
        <li>
          Stand at the <strong>back</strong> of the space, where the player will start, facing where the Chromebook will stand (the <strong>front</strong>). Left and right are as you face it.
        </li>
        <li>
          <strong>Length:</strong> from the back wall (or furniture) to the front, where the Chromebook stands.
        </li>
        <li>
          <strong>Width:</strong> side to side at the narrowest point. If furniture sticks out, measure to the furniture.
        </li>
        <li>
          <strong>Fixed points:</strong> two to four things on the edges that never move (a door frame, radiator, sofa corner, window edge). For each, measure how far it is from the back wall (or, on the back or front, from the left side). Each drill then says "level with the door frame" instead of making you measure again.
        </li>
      </ol>
      <div className="grid2">
        <LengthInput label="Clear floor length" units={units} min={2} value={profile.approxUsableM?.length ?? dims.length} onChange={(length) => onChange({ ...dropGuided(profile), measured: true, approxUsableM: { length, width: profile.approxUsableM?.width ?? dims.width } })} />
        <LengthInput label="Clear floor width" units={units} min={1} value={profile.approxUsableM?.width ?? dims.width} onChange={(width) => onChange({ ...dropGuided(profile), measured: true, approxUsableM: { width, length: profile.approxUsableM?.length ?? dims.length } })} />
      </div>
      <div className="grid2">
        <div className="stack">
          <strong>Fixed reference points</strong>
          {marks.length === 0 ? <p className="muted">None yet. They are optional, but they make setting out cones much quicker.</p> : null}
          {marks.map((m, i) => (
            <div key={m.id} className="card tight stack" data-testid={`landmark-row-${i}`}>
              <div className="row">
                <input type="text" list="landmark-names" value={m.label} aria-label={`Reference point ${i + 1} name`} onChange={(e) => update(m.id, { label: e.target.value })} style={{ flex: 1 }} />
                <button className="btn small" onClick={() => setMarks(marks.filter((x) => x.id !== m.id))}>
                  Remove
                </button>
              </div>
              <label className="row">
                <span className="muted">On the</span>
                <select value={m.side} aria-label={`Reference point ${i + 1} side`} onChange={(e) => update(m.id, { side: e.target.value as Landmark['side'] })}>
                  {SIDES.map((sd) => (
                    <option key={sd} value={sd}>
                      {SIDE_TEXT[sd]}
                    </option>
                  ))}
                </select>
              </label>
              <LengthInput
                label={m.side === 'left' || m.side === 'right' ? `Reference point ${i + 1}: distance from the back wall` : `Reference point ${i + 1}: distance from the left side`}
                units={units}
                min={0}
                value={m.alongM}
                onChange={(alongM) => update(m.id, { alongM })}
              />
            </div>
          ))}
          <datalist id="landmark-names">
            {LANDMARK_SUGGESTIONS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <div>
            <button
              className="btn small"
              onClick={() => setMarks([...marks, { id: crypto.randomUUID(), label: unused[0] ?? 'Reference point', side: marks.length % 2 ? 'left' : 'right', alongM: Math.round((dims.length / 2) * 10) / 10 }])}
            >
              + Add a fixed point
            </button>
          </div>
        </div>
        <div className="stack">
          <strong>Your room from above</strong>
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
            maxHeight={340}
          />
        </div>
      </div>
    </div>
  );
}
