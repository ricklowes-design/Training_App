import type { LayoutGeometry } from '../content/types';
import type { DerivedLayout, Pt, RoomLayout, RoomProfile, UsableSpaceClass } from '../db/types';
import { deriveLayout, gateInner, MIN_BOX_M, MIN_GATE_M, type RoomInput } from './layout';

// Room profiles (part 15 D1, part 16 §2). No tape, no measuring: the usable space comes
// from the parent's pick of a class, the safe floor polygon drawn on the camera photo, or
// approximate dimensions when the parent happens to know them. All of it is approximate
// and only scales drill geometry; it is never a metric calibration.

/** Nominal clear floor for each class, used to scale drill geometry when nothing better is known. */
export const CLASS_DIMS: Record<UsableSpaceClass, { length: number; width: number; text: string }> = {
  compact: { length: 4.2, width: 2.4, text: 'Compact: about 4 × 2.4 m of clear floor' },
  standard: { length: 6.1, width: 3.0, text: 'Standard: about 6 × 3 m of clear floor' },
  extended: { length: 7.5, width: 3.6, text: 'Extended: 7 m or more of clear floor, 3.5 m wide' },
};

export function classFromDims(lengthM: number, widthM: number): UsableSpaceClass {
  if (lengthM >= 7 && widthM >= 3.5) return 'extended';
  if (lengthM >= 5.5 && widthM >= 2.8) return 'standard';
  return 'compact';
}

/** Shoelace area of a polygon in photo coordinates (0..1). */
export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Rough clear floor from the safe polygon. The camera sits at the lane end about 1.5 m up,
 * so how far up the picture the safe floor reaches stands in for clear length, and its
 * spread across the picture for width. A heuristic to scale drills, labelled approximate
 * wherever it is shown, and tuned from the parent's room checks (part 16 §12 "Room").
 */
export function polygonDims(poly: Pt[]): { length: number; width: number } {
  if (poly.length < 3) return { length: 0, width: 0 };
  const ys = poly.map((p) => p.y);
  const xs = poly.map((p) => p.x);
  const reach = Math.max(0, Math.min(1, Math.max(...ys) - Math.min(...ys)));
  const spread = Math.max(0, Math.min(1, Math.max(...xs) - Math.min(...xs)));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { length: r1(1.5 + 8 * reach), width: r1(0.8 + 3.3 * spread) };
}

/** The clear floor drills are scaled to, and where it came from. */
export function effectiveDims(p: Pick<RoomProfile, 'approxUsableM' | 'safePolygonNormalized' | 'usableSpaceClass' | 'spaceSource'>): { length: number; width: number } {
  if (p.spaceSource === 'approxDims' && p.approxUsableM) return p.approxUsableM;
  if (p.spaceSource === 'polygon' && p.safePolygonNormalized.length >= 3) return polygonDims(p.safePolygonNormalized);
  return CLASS_DIMS[p.usableSpaceClass];
}

export function profileClass(p: Pick<RoomProfile, 'approxUsableM' | 'safePolygonNormalized' | 'usableSpaceClass' | 'spaceSource'>): UsableSpaceClass {
  if (p.spaceSource === 'parentClass') return p.usableSpaceClass;
  const d = effectiveDims(p);
  return classFromDims(d.length, d.width);
}

/** The room input drill geometry is derived from. */
export function roomInputFor(p: RoomProfile, cones: number): RoomInput {
  const dims = effectiveDims(p);
  return { roomLengthM: dims.length, roomWidthM: dims.width, floor: p.floor, wallUsable: p.wallUsable, cones };
}

/** The narrowest room each layout fits, in metres (with the narrow-room version when the content has one). */
export function minWidthM(g: LayoutGeometry, layoutId: 'L2' | 'L3'): number {
  if (layoutId === 'L2') {
    if (g.feintLane.single) return g.feintLane.single.minWidthM;
    const n = g.feintLane.narrow;
    return n ? 2 * (n.innerM + n.minGateM + n.wallGapM) : 2 * (0.3 + MIN_GATE_M + 0.3);
  }
  if (g.receiveBox.single) return g.receiveBox.single.minWidthM;
  const n = g.receiveBox.narrow;
  return n ? n.minSideM + 2 * n.sideClearanceM : MIN_BOX_M + 2 * g.receiveBox.sideClearanceM;
}
const narrowWidthText = (g: LayoutGeometry, id: 'L2' | 'L3') => `${(Math.ceil(minWidthM(g, id) * 10) / 10).toFixed(1)} m`;

/** Minimum geometry each layout needs to stay safe and meaningful (no long runs, no sprinting). */
export function layoutFit(layoutId: string, d: DerivedLayout, g: LayoutGeometry, cones?: number): { ok: boolean; reason?: string } {
  const need = layoutCones(layoutId, d, 0).length;
  if (cones !== undefined && need > cones) return { ok: false, reason: `needs ${need} cones (you have ${cones})` };
  switch (layoutId) {
    case 'L1':
      return (d.slalomCones ?? g.slalom.cones) >= 3 && d.slalomSpacingM >= g.slalom.minSpacingM - 1e-9
        ? { ok: true }
        : { ok: false, reason: 'the slalom needs about 3.5 m of clear length' };
    case 'L2':
      if (d.feintConeM < 1.5) return { ok: false, reason: 'the feint lane needs about 4 m of clear length' };
      if (d.narrow?.includes('L2') || d.singleCone?.includes('L2')) return { ok: true };
      return d.feintGateWidthM >= MIN_GATE_M - 1e-9 ? { ok: true } : { ok: false, reason: `the feint lane needs about ${narrowWidthText(g, 'L2')} of clear width` };
    case 'L3':
      if (d.narrow?.includes('L3') || d.singleCone?.includes('L3')) return { ok: true };
      return d.receiveBoxSideM >= MIN_BOX_M - 1e-9 ? { ok: true } : { ok: false, reason: `the receiving drills need about ${narrowWidthText(g, 'L3')} of clear width` };
    case 'L4':
      return d.masterySquareM >= 1 ? { ok: true } : { ok: false, reason: 'needs a 1 m square' };
    default:
      return { ok: true };
  }
}

/** Drill geometry for a room input; in a short room the slalom uses fewer cones rather than cramped spacing. */
export function scaledLayout(input: RoomInput, g: LayoutGeometry): DerivedLayout {
  const free = input.roomLengthM - g.slalom.startFromWallM - g.slalom.stopZoneM - g.slalom.marginM;
  // Never more slalom cones than the family has (fewer than 3 is refused by layoutFit).
  let n = Math.max(1, Math.min(g.slalom.cones, input.cones));
  while (n > 3 && free / (n - 1) < g.slalom.minSpacingM - 1e-9) n--;
  // With fewer than the standard cones, spacing is never stretched past the maximum.
  const d = deriveLayout(input, n === g.slalom.cones ? g : { ...g, slalom: { ...g.slalom, cones: n } });
  // Below the minimum spacing even with three cones, the raw spacing is kept so layoutFit can refuse it.
  return free / (n - 1) < g.slalom.minSpacingM - 1e-9 ? { ...d, slalomSpacingM: Number(Math.max(0, free / (n - 1)).toFixed(2)) } : d;
}

/** Whether a profile's geometry differs from a layout, so a new layout version is needed. */
export function layoutFromProfile(p: RoomProfile, current: RoomLayout | undefined, cones: number, g: LayoutGeometry, now = new Date(), nextVersion?: number): RoomLayout | null {
  const input = roomInputFor(p, cones);
  const derived = scaledLayout(input, g);
  if (
    current &&
    current.roomLengthM === input.roomLengthM &&
    current.roomWidthM === input.roomWidthM &&
    current.floor === input.floor &&
    current.wallUsable === input.wallUsable &&
    current.cones === input.cones &&
    JSON.stringify(current.derived) === JSON.stringify(derived)
  ) {
    return null;
  }
  return {
    version: nextVersion ?? (current?.version ?? 0) + 1,
    createdAt: now.toISOString(),
    ...input,
    derived,
    roomProfileId: p.id,
    roomProfileVersion: p.version,
    usableSpaceClass: p.usableSpaceClass,
  };
}

/** Fields whose change makes a new profile version (and so a new comparison context). */
export function profileChanged(a: RoomProfile, b: RoomProfile): boolean {
  const key = (p: RoomProfile) =>
    JSON.stringify([p.safePolygonNormalized, p.anchors.map((x) => [x.pt, x.label]), p.usableSpaceClass, p.spaceSource, p.approxUsableM, p.floor, p.wallUsable, p.mountConfirmed, p.backgroundThumb?.length]);
  return key(a) !== key(b);
}

export function newProfile(id: string, name: string, now: string): RoomProfile {
  return {
    id,
    name,
    version: 1,
    createdAt: now,
    updatedAt: now,
    anchors: [],
    mountConfirmed: false,
    safePolygonNormalized: [],
    clearanceSetting: 0.5,
    usableSpaceClass: 'standard',
    spaceSource: 'parentClass',
    scaleSource: 'none',
    floor: 'hard',
    wallUsable: false,
    savedLayoutRefs: [],
  };
}

/** A profile made from the measurements of an earlier app version (schema 2 → 3 migration). */
export function profileFromLegacyLayout(l: RoomLayout, now: string): RoomProfile {
  return {
    ...newProfile('room-1', 'Main room', now),
    usableSpaceClass: classFromDims(l.roomLengthM, l.roomWidthM),
    spaceSource: 'approxDims',
    approxUsableM: { length: l.roomLengthM, width: l.roomWidthM },
    scaleSource: 'migratedRoomDimensions',
    floor: l.floor,
    wallUsable: l.wallUsable,
  };
}

/** Pixel position of a floor point (metres across, metres along the lane from the start wall) on the photo,
 *  using the safe polygon as the floor and a simple perspective: the start wall is far (top), the camera end near (bottom).
 *  Only a starting suggestion for the cone overlay; the parent drags the cones to where they really are. */
export function suggestPoint(poly: Pt[], lengthM: number, widthM: number, floor: [number, number]): Pt {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const [x0, x1, yTop, yBot] = poly.length >= 3 ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] : [0.2, 0.8, 0.35, 0.95];
  const t = Math.max(0, Math.min(1, 1 - floor[1] / Math.max(lengthM, 0.1))); // 0 at the camera end, 1 at the start wall
  const k = 1.5;
  const depth = (t * (1 + k)) / (1 + k * t); // far distances compressed
  const y = yBot - (yBot - yTop) * depth;
  const half = ((x1 - x0) / 2) * (1 - 0.45 * depth);
  const cx = (x0 + x1) / 2;
  const x = cx + (floor[0] / Math.max(widthM / 2, 0.1)) * half;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

/** All cones of a standard layout in floor metres (x across from the lane centre, y along from the start wall). */
export function layoutCones(layoutId: string, d: DerivedLayout, lengthM: number): { name: string; floor: [number, number] }[] {
  switch (layoutId) {
    case 'L1': {
      const n = d.slalomCones ?? 5;
      return Array.from({ length: n }, (_, i) => ({ name: `Slalom cone ${i + 1}`, floor: [0, d.slalomFirstConeM + i * d.slalomSpacingM] as [number, number] }));
    }
    case 'L2': {
      const g = d.feintGateWidthM;
      const gi = gateInner(d);
      if (d.singleCone?.includes('L2'))
        return [
          ...(d.feintStartCone === false ? [] : [{ name: 'Start cone', floor: [0, d.feintStartM ?? 0.5] as [number, number] }]),
          { name: 'Feint cone', floor: [0, d.feintConeM] },
          { name: 'Exit cone', floor: [0, d.feintGateAtM] },
        ];
      return [
        ...(d.feintStartCone === false ? [] : [{ name: 'Start cone', floor: [0, d.feintStartM ?? 0.5] as [number, number] }]),
        { name: 'Feint cone', floor: [0, d.feintConeM] },
        { name: 'Left gate, inner', floor: [-gi, d.feintGateAtM] },
        { name: 'Left gate, outer', floor: [-gi - g, d.feintGateAtM] },
        { name: 'Right gate, inner', floor: [gi, d.feintGateAtM] },
        { name: 'Right gate, outer', floor: [gi + g, d.feintGateAtM] },
      ];
    }
    case 'L3': {
      const s = d.receiveBoxSideM / 2;
      const mid = lengthM / 2;
      if (d.singleCone?.includes('L3'))
        return [
          { name: 'Receive cone, far', floor: [0, mid - s] },
          { name: 'Receive cone, near', floor: [0, mid + s] },
        ];
      return [
        { name: 'Box, far left', floor: [-s, mid - s] },
        { name: 'Box, far right', floor: [s, mid - s] },
        { name: 'Box, near left', floor: [-s, mid + s] },
        { name: 'Box, near right', floor: [s, mid + s] },
      ];
    }
    default: {
      const s = d.masterySquareM / 2;
      return [
        { name: 'Square, far left', floor: [-s, lengthM - 1 - 2 * s] },
        { name: 'Square, far right', floor: [s, lengthM - 1 - 2 * s] },
        { name: 'Square, near left', floor: [-s, lengthM - 1] },
        { name: 'Square, near right', floor: [s, lengthM - 1] },
      ];
    }
  }
}

/** The latest layout version made for a profile (layouts from before profiles belong to the migrated "room-1"). */
export function layoutForProfile<T extends Pick<RoomLayout, 'version' | 'roomProfileId'>>(layouts: T[], profileId: string | undefined): T | undefined {
  const own = layouts.filter((l) => (l.roomProfileId ?? 'room-1') === profileId).sort((a, b) => a.version - b.version);
  return own[own.length - 1];
}
