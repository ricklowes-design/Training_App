import { useData } from '../app/data';
import type { Programme } from '../content/types';
import { coneGuide, landmarkFloor } from '../domain/landmarks';
import type { RunBlock } from '../domain/plans';
import { layoutFit } from '../domain/room';
import { LayoutDiagram, LayoutLegend } from '../ui/LayoutDiagram';
import { useFloorImage } from '../screens/parent/FloorMap';

// The cone set-up, shown when a drill starts (parent request 2026-10-26) rather than at the first
// set-up: a numbered plan of this room, the measured fixed points and the floor map from the photo,
// and one line per cone saying where it goes.

export const blockLayout = (p: Programme, b: RunBlock | undefined): string | undefined =>
  b ? (p.drills.find((d) => d.id === b.drillId)?.layoutId ?? (b.anchorId ? p.anchors.find((a) => a.id === b.anchorId)?.layoutId : undefined)) : undefined;

/** True when this block needs a different cone layout from the last block that had one (or is the first). */
export function conesChanged(blocks: RunBlock[], idx: number, p: Programme): boolean {
  const mine = blockLayout(p, blocks[idx]);
  if (!mine) return false;
  for (let i = idx - 1; i >= 0; i--) {
    const l = blockLayout(p, blocks[i]);
    if (l) return l !== mine;
  }
  return true;
}

export function ConeSetup({ layoutId, changed }: { layoutId: string; changed: boolean }) {
  const { programme: p, layout, roomProfile, settings } = useData();
  const units = settings.units ?? 'metric';
  const floorImage = useFloorImage(roomProfile);
  if (!layout) return null;
  const L = layout.roomLengthM;
  const W = layout.roomWidthM;
  const fit = layoutFit(layoutId, layout.derived, p.layoutGeometry, layout.cones);
  const marks = roomProfile?.landmarks ?? [];
  const guide = coneGuide(layoutId, layout.derived, L, W, marks, units);
  return (
    <div className={`card tight stack cone-setup${changed ? ' changed' : ''}`} data-testid="cone-setup">
      <h2 style={{ margin: 0 }}>{changed ? 'Set out the cones' : 'Cones: same as the last block'} · {p.layouts[layoutId]?.name ?? layoutId}</h2>
      <div className="grid2">
        <LayoutDiagram
          layoutId={layoutId}
          d={layout.derived}
          lengthM={L}
          widthM={W}
          floor={layout.floor}
          units={units}
          screenBehindM={p.layoutGeometry.receiveBox.cueScreenBehindM}
          unavailable={fit.ok ? undefined : 'not available'}
          landmarks={marks.map((m) => ({ label: m.label, floor: landmarkFloor(m, L, W) }))}
          floorImage={floorImage}
          numbered
          maxHeight={340}
        />
        <ol className="cone-list">
          {guide.map((c) => (
            <li key={c.n}>
              <strong>{c.name}:</strong> {c.text}
            </li>
          ))}
        </ol>
      </div>
      {marks.length === 0 ? <p className="muted">Tip: add two or three fixed points (door frame, radiator…) in Parent → Room profiles, and each cone is placed against them.</p> : null}
      <LayoutLegend />
    </div>
  );
}
