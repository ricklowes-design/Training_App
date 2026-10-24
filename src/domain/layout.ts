import type { LayoutGeometry } from '../content/types';
import type { DerivedLayout, RoomLayout } from '../db/types';

const round = (x: number, step = 0.1) => Math.round(x / step) * step;
const floorTo = (x: number, step = 0.1) => Math.floor(x / step + 1e-9) * step;
const fix = (x: number) => Number(x.toFixed(2));

export interface RoomInput {
  roomLengthM: number;
  roomWidthM: number;
  floor: RoomLayout['floor'];
  wallUsable: boolean;
  cones: number;
}

/** Standard layouts (plan/03 §3.3) derived from the room's size. */
export function deriveLayout(room: RoomInput, g: LayoutGeometry): DerivedLayout {
  const s = g.slalom;
  const free = room.roomLengthM - s.startFromWallM - s.stopZoneM - s.marginM;
  const spacing = Math.max(s.minSpacingM, Math.min(s.maxSpacingM, floorTo(free / (s.cones - 1))));

  const f = g.feintLane;
  // Room for: start, feint cone, gates 1.2 m past it, then the stop zone.
  const feintCone = Math.min(f.maxFeintConeM, floorTo(room.roomLengthM - f.gatePastConeM - f.stopZoneM - f.startFromWallM));

  const r = g.receiveBox;
  const box = Math.min(r.maxSideM, floorTo(room.roomWidthM - 2 * r.sideClearanceM));

  return {
    slalomCones: s.cones,
    feintStartM: fix(f.startFromWallM),
    slalomSpacingM: fix(spacing),
    slalomFirstConeM: fix(s.startFromWallM),
    slalomStopZoneM: fix(s.stopZoneM),
    feintConeM: fix(feintCone),
    feintGateAtM: fix(round(feintCone + f.gatePastConeM)),
    feintGateWidthM: fix(f.gateWidthM),
    feintStopZoneM: fix(f.stopZoneM),
    receiveBoxSideM: fix(box),
    receiveGateWidthM: fix(r.gateWidthM),
    masterySquareM: fix(g.masterySquare.sideM),
  };
}

/** True when the room inputs differ from the current layout, so a new layout version is needed. */
export function roomChanged(current: RoomLayout | undefined, room: RoomInput): boolean {
  if (!current) return true;
  return (
    current.roomLengthM !== room.roomLengthM ||
    current.roomWidthM !== room.roomWidthM ||
    current.floor !== room.floor ||
    current.wallUsable !== room.wallUsable ||
    current.cones !== room.cones
  );
}

export function nextLayout(current: RoomLayout | undefined, room: RoomInput, g: LayoutGeometry, now = new Date()): RoomLayout {
  return {
    version: (current?.version ?? 0) + 1,
    createdAt: now.toISOString(),
    ...room,
    derived: deriveLayout(room, g),
  };
}

export function layoutSummary(d: DerivedLayout): Record<string, string> {
  return {
    L1: `${d.slalomCones ?? 5} cones ${d.slalomSpacingM} m apart, first cone ${d.slalomFirstConeM} m from the end wall; ${d.slalomStopZoneM} m stop zone at the far end`,
    L2: `Start cone ${d.feintStartM ?? 0.5} m from the end wall; feint cone at ${d.feintConeM} m; two ${d.feintGateWidthM} m gates at ${d.feintGateAtM} m, left and right; ${d.feintStopZoneM} m stop zone`,
    L3: `${d.receiveBoxSideM} m square mid-room; a ${d.receiveGateWidthM} m gate on each side; cue screen behind the box`,
    L4: `${d.masterySquareM} m square at one end`,
  };
}
