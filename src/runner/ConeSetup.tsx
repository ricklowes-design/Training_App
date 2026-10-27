import { useData } from '../app/data';
import type { Programme } from '../content/types';
import type { DerivedLayout } from '../db/types';
import { coneGuide, landmarkFloor } from '../domain/landmarks';
import { spaceRefs, workspace } from '../domain/space';
import type { RunBlock } from '../domain/plans';
import { layoutFit } from '../domain/room';
import { LayoutDiagram, LayoutLegend } from '../ui/LayoutDiagram';
import { useFloorImage } from '../screens/parent/FloorMap';

// The cone set-up, shown when a drill starts (parent request 2026-10-26) rather than at the first
// set-up: a numbered plan of this room, the measured fixed points and the floor map from the photo,
// and one line per cone saying where it goes.

export const blockLayout = (p: Programme, b: RunBlock | undefined): string | undefined =>
  b
    ? (p.drills.find((d) => d.id === b.drillId)?.layoutId ??
      (b.anchorId ? p.anchors.find((a) => a.id === b.anchorId)?.layoutId : undefined) ??
      (b.benchmarkId ? p.benchmarks.find((x) => x.id === b.benchmarkId)?.layoutId : undefined))
    : undefined;

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

/** How this room changes the drill, when it does (the drill's own text still talks about gates and boxes). */
export function variantNote(layoutId: string, d: DerivedLayout): string | null {
  if (layoutId === 'L2' && d.singleCone?.includes('L2')) return 'This room’s version: no gates. Wherever the drill says “gate”, go past the exit cone on that side.';
  if (layoutId === 'L3' && d.singleCone?.includes('L3')) return 'This room’s version: no box. Receive the ball between the two cones; wherever the drill says “gate”, go past the cones on that side and stop.';
  if (layoutId === 'L2' && d.narrow?.includes('L2')) return 'This room’s version: narrower gates, closer to the lane.';
  if (layoutId === 'L3' && d.narrow?.includes('L3')) return 'This room’s version: a smaller box with short exits: one touch out, then stop.';
  return null;
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
  const space = roomProfile?.space;
  const guide = coneGuide(layoutId, layout.derived, L, W, marks, units, space);
  // Reference points on the plan: the measured things (guided measurement) or the fixed points.
  const ws = space ? workspace(space) : null;
  const points = ws
    ? spaceRefs(space!).map((r) => ({ label: r.label, floor: [r.at[0] - (ws.x0 + ws.x1) / 2, r.at[1] - ws.y0] as [number, number] }))
    : marks.map((m) => ({ label: m.label, floor: landmarkFloor(m, L, W) }));
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
          landmarks={points}
          floorImage={floorImage}
          floorImageCovers={roomProfile?.floorMap?.covers ?? 'clear'}
          space={space}
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
      {variantNote(layoutId, layout.derived) ? (
        <p className="pill info" data-testid="layout-variant">
          {variantNote(layoutId, layout.derived)}
        </p>
      ) : null}
      {points.length === 0 ? <p className="muted">Tip: measure from two or three things in the room (Parent → Re-run first-run set-up → Your space), and each cone is placed against them.</p> : null}
      <LayoutLegend />
    </div>
  );
}
