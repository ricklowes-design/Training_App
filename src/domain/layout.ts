import type { LayoutGeometry } from '../content/types';
import type { DerivedLayout, RoomLayout } from '../db/types';
import { fmtLen, type Units } from './units';

const round = (x: number, step = 0.1) => Math.round(x / step) * step;
const floorTo = (x: number, step = 0.1) => Math.floor(x / step + 1e-9) * step;
const fix = (x: number) => Number(x.toFixed(2));

/** Lane centre to the inner cone of each feint gate, and the gap kept between a gate and a side wall. */
export const FEINT_GATE_INNER_M = 0.3;
export const WALL_GAP_M = 0.3;
/** The standard layouts' smallest feint gate and receive box; below these the narrow-room version is used. */
export const MIN_GATE_M = 0.5;
export const MIN_BOX_M = 0.9;
export const gateInner = (d: DerivedLayout) => d.feintGateInnerM ?? FEINT_GATE_INNER_M;

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
  const half = room.roomWidthM / 2;
  let inner = FEINT_GATE_INNER_M;
  let gateWidth = Math.min(f.gateWidthM, floorTo(Number((half - FEINT_GATE_INNER_M - WALL_GAP_M).toFixed(3))));
  const narrow: string[] = [];
  // Narrow-room version (content: feintLane.narrow): too narrow for 0.5 m gates, so the gates move
  // in toward the lane and closer to the walls, and stay at least minGateM wide.
  const fn = f.narrow;
  if (fn && gateWidth < MIN_GATE_M - 1e-9) {
    const w = Math.min(f.gateWidthM, floorTo(Number((half - fn.innerM - fn.wallGapM).toFixed(3)), 0.05));
    if (w >= fn.minGateM - 1e-9) {
      inner = fn.innerM;
      gateWidth = w;
      narrow.push('L2');
    }
  }

  // Single-cone version (content: feintLane.single): no gates, one exit cone to go left or right of.
  // Used when even the narrow gates do not fit, or there are too few cones for four gate cones.
  const single: string[] = [];
  const gatesFit = narrow.includes('L2') || gateWidth >= MIN_GATE_M - 1e-9;
  if (f.single && (!gatesFit || room.cones < 5) && room.roomWidthM >= f.single.minWidthM - 1e-9) {
    inner = 0;
    gateWidth = 0;
    single.push('L2');
    if (narrow[0] === 'L2') narrow.shift();
  }

  const r = g.receiveBox;
  let box = Math.min(r.maxSideM, floorTo(room.roomWidthM - 2 * r.sideClearanceM));
  // Narrow-room version (content: receiveBox.narrow): shorter exits either side of the box.
  const rn = r.narrow;
  if (rn && box < MIN_BOX_M - 1e-9) {
    const b = Math.min(r.maxSideM, floorTo(room.roomWidthM - 2 * rn.sideClearanceM));
    if (b >= rn.minSideM - 1e-9) {
      box = b;
      narrow.push('L3');
    }
  }
  // Single-cone version (content: receiveBox.single): two cones in a line, exits left or right of them.
  if (r.single && (box < MIN_BOX_M - 1e-9 || room.cones < 4) && room.roomWidthM >= r.single.minWidthM - 1e-9) {
    box = r.single.coneGapM;
    single.push('L3');
    const k = narrow.indexOf('L3');
    if (k >= 0) narrow.splice(k, 1);
  }

  return {
    slalomCones: s.cones,
    feintStartM: fix(f.startFromWallM),
    slalomSpacingM: fix(spacing),
    slalomFirstConeM: fix(s.startFromWallM),
    slalomStopZoneM: fix(s.stopZoneM),
    feintConeM: fix(feintCone),
    feintGateAtM: fix(round(feintCone + f.gatePastConeM)),
    feintGateWidthM: fix(Math.max(0, gateWidth)),
    ...(inner !== FEINT_GATE_INNER_M && !single.includes('L2') ? { feintGateInnerM: inner } : {}),
    feintStopZoneM: fix(f.stopZoneM),
    // Six cones with a start cone; with five, the run starts from the back wall.
    // The single-cone version needs only the feint and exit cones, so a third cone is the start cone.
    ...(room.cones < (single.includes('L2') ? 3 : 6) ? { feintStartCone: false } : {}),
    receiveBoxSideM: fix(box),
    // A gate is never wider than the box side it sits on; the single-cone version has none.
    receiveGateWidthM: single.includes('L3') ? 0 : fix(Math.min(r.gateWidthM, box)),
    masterySquareM: fix(g.masterySquare.sideM),
    ...(narrow.length ? { narrow } : {}),
    ...(single.length ? { singleCone: single } : {}),
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
    L2: d.singleCone?.includes('L2')
      ? `${start}; feint cone at ${L(d.feintConeM)}; one exit cone at ${L(d.feintGateAtM)} on the same line: exit past it on the left or the right (single-cone version, no gates); ${L(d.feintStopZoneM)} stop zone`
      : `${start}; feint cone at ${L(d.feintConeM)}; two ${L(d.feintGateWidthM)} gates at ${L(d.feintGateAtM)}, left and right${d.narrow?.includes('L2') ? `, ${L(gateInner(d))} either side of the lane (narrow-room version)` : ''}; ${L(d.feintStopZoneM)} stop zone`,
    L3: d.singleCone?.includes('L3')
      ? `two cones ${L(d.receiveBoxSideM)} apart in a line mid-room, where the ball is received; exit past them on the left or the right and stop (single-cone version, no box); cue screen behind`
      : `${L(d.receiveBoxSideM)} square mid-room; a ${L(d.receiveGateWidthM)} gate on each side; cue screen behind the box${d.narrow?.includes('L3') ? ' (narrow-room version: short exits, one touch out of the box and stop)' : ''}`,
    L4: `${L(d.masterySquareM)} square near the front`,
  };
}
