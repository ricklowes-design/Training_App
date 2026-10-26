import type { DerivedLayout, Landmark, Space } from '../db/types';
import { spaceRefs, workspace, type Ref } from './space';
import { layoutCones } from './room';
import { fmtLen, type Units } from './units';

// Placing cones against the room (set-up measured once): every cone is given as a distance from
// the back wall and from the nearer side, plus the closest fixed reference point when one is near.
// Room coordinates: x across from the centre line (left negative, facing the Chromebook), y from
// the back (start) wall.

export const LANDMARK_SUGGESTIONS = ['Door frame', 'Radiator', 'Sofa corner', 'Window edge', 'Bookcase edge', 'Light switch', 'Wall corner', 'Table leg'];

export const SIDE_TEXT: Record<Landmark['side'], string> = {
  left: 'left side',
  right: 'right side',
  back: 'back wall',
  front: 'front (Chromebook) end',
};

/** Where a landmark sits on the floor plan. */
export function landmarkFloor(l: Pick<Landmark, 'side' | 'alongM'>, lengthM: number, widthM: number): [number, number] {
  const along = Math.max(0, l.alongM);
  switch (l.side) {
    case 'left':
      return [-widthM / 2, Math.min(lengthM, along)];
    case 'right':
      return [widthM / 2, Math.min(lengthM, along)];
    case 'back':
      return [Math.min(widthM, along) - widthM / 2, 0];
    case 'front':
      return [Math.min(widthM, along) - widthM / 2, lengthM];
  }
}

/** Corners of the clear floor, usable as known points on the room photo. */
export const CORNERS = ['back-left', 'back-right', 'front-left', 'front-right'] as const;
export function cornerFloor(c: (typeof CORNERS)[number], lengthM: number, widthM: number): [number, number] {
  return [c.endsWith('left') ? -widthM / 2 : widthM / 2, c.startsWith('back') ? 0 : lengthM];
}

/** A floor-map reference ('corner:back-left' or a landmark id) → its room position and name. */
export function refPoint(ref: string, landmarks: Landmark[], lengthM: number, widthM: number): { floor: [number, number]; label: string } | null {
  if (ref.startsWith('corner:')) {
    const c = ref.slice(7) as (typeof CORNERS)[number];
    if (!CORNERS.includes(c)) return null;
    return { floor: cornerFloor(c, lengthM, widthM), label: `${c.replace('-', ' ')} corner of the clear floor` };
  }
  const l = landmarks.find((x) => x.id === ref);
  return l ? { floor: landmarkFloor(l, lengthM, widthM), label: l.label } : null;
}

export interface ConeGuide {
  n: number;
  name: string;
  floor: [number, number];
  text: string;
}

const LEVEL_M = 0.12; // "level with" a reference point
const NEAR_M = 0.75; // close enough to be a useful reference

/** Numbered placement instructions for a layout's cones, in the parent's units. With a guided
 *  measurement (space), distances are from the real walls and the measured things; otherwise from
 *  the edges of the clear floor and the fixed points entered for it. */
export function coneGuide(layoutId: string, d: DerivedLayout, lengthM: number, widthM: number, landmarks: Landmark[] = [], units: Units = 'metric', space?: Space): ConeGuide[] {
  const L = (m: number) => fmtLen(Math.abs(m), units);
  const ws = space ? workspace(space) : null;
  // Clear-floor coordinates → wall coordinates.
  const W = space?.widthM ?? widthM;
  const cx = ws ? (ws.x0 + ws.x1) / 2 : widthM / 2;
  const y0 = ws?.y0 ?? 0;
  const refs: Ref[] = space
    ? spaceRefs(space)
    : landmarks.map((l) => {
        const [x, y] = landmarkFloor(l, lengthM, widthM);
        return { label: l.label.toLowerCase(), at: [x + widthM / 2, y] as [number, number], side: l.side };
      });
  return layoutCones(layoutId, d, lengthM).map((c, i) => {
    const wx = cx + c.floor[0];
    const wy = y0 + c.floor[1];
    const across = !space
      ? Math.abs(c.floor[0]) < 0.03
        ? 'on the centre line'
        : `${L(widthM / 2 - Math.abs(c.floor[0]))} in from the ${c.floor[0] < 0 ? 'left' : 'right'} side`
      : Math.abs(wx - W / 2) < 0.03
        ? `in the middle, ${L(W / 2)} from each side wall`
        : wx <= W / 2
          ? `${L(wx)} from the left wall`
          : `${L(W - wx)} from the right wall`;
    const parts = [`${L(wy)} from the back wall`, across];
    const leftHalf = wx <= W / 2;
    // Along the room: the reference closest in distance from the back wall, preferring this cone's side.
    const along = refs
      .filter((r) => r.side !== 'back' && r.side !== 'front')
      .map((r) => ({ r, dy: wy - r.at[1], own: r.at[0] <= W / 2 === leftHalf }))
      .filter((m) => Math.abs(m.dy) <= NEAR_M)
      .sort((a, b) => Number(b.own) - Number(a.own) || Math.abs(a.dy) - Math.abs(b.dy))[0];
    const tag = (r: Ref) => (r.side ? ` (${r.side})` : '');
    if (along) {
      parts.push(
        Math.abs(along.dy) <= LEVEL_M
          ? `level with the ${along.r.label}${tag(along.r)}`
          : `${L(along.dy)} ${along.dy > 0 ? 'nearer the front' : 'nearer the back'} than the ${along.r.label}${tag(along.r)}`,
      );
    }
    // Across the room: in line with something on the back or front wall.
    const inLine = refs.find((r) => (r.side === 'back' || r.side === 'front') && Math.abs(r.at[0] - wx) <= LEVEL_M);
    if (inLine) parts.push(`in line with the ${inLine.label} on the ${SIDE_TEXT[inLine.side as Landmark['side']]}`);
    return { n: i + 1, name: c.name, floor: c.floor, text: parts.join(', ') };
  });
}
