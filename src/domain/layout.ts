import type { LayoutGeometry } from '../content/types';
import type { DerivedLayout, RoomLayout } from '../db/types';
import { fmtLen, type Units } from './units';

const round = (x: number, step = 0.1) => Math.round(x / step) * step;
const floorTo = (x: number, step = 0.1) => Math.floor(x / step + 1e-9) * step;
const fix = (x: number) => Number(x.toFixed(2));

/** Lane centre to the inner cone of each feint gate, and the gap kept between a gate and a side wall. */
export const FEINT_GATE_INNER_M = 0.3;
export const WALL_GAP_M = 0.3;

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
  // Gates sit 0.3 m either side of the lane; in a narrow room they get narrower so each outer
  // cone keeps 0.3 m from the side wall (the standard 3 m room keeps the plan's gate width).
  const gateWidth = Math.min(f.gateWidthM, floorTo(Number((room.roomWidthM / 2 - FEINT_GATE_INNER_M - WALL_GAP_M).toFixed(3))));

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
    feintGateWidthM: fix(Math.max(0, gateWidth)),
    feintStopZoneM: fix(f.stopZoneM),
    // Six cones with a start cone; with five, the run starts from the back wall.
    ...(room.cones < 6 ? { feintStartCone: false } : {}),
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

export function layoutSummary(d: DerivedLayout, units: Units = 'metric'): Record<string, string> {
  const L = (m: number) => fmtLen(m, units);
  const start = d.feintStartCone === false ? 'Start at the back wall (no start cone)' : `Start cone ${L(d.feintStartM ?? 0.5)} from the back wall`;
  return {
    L1: `${d.slalomCones ?? 5} cones ${L(d.slalomSpacingM)} apart, first cone ${L(d.slalomFirstConeM)} from the back wall; ${L(d.slalomStopZoneM)} stop zone at the front`,
    L2: `${start}; feint cone at ${L(d.feintConeM)}; two ${L(d.feintGateWidthM)} gates at ${L(d.feintGateAtM)}, left and right; ${L(d.feintStopZoneM)} stop zone`,
    L3: `${L(d.receiveBoxSideM)} square mid-room; a ${L(d.receiveGateWidthM)} gate on each side; cue screen behind the box`,
    L4: `${L(d.masterySquareM)} square near the front`,
  };
}
