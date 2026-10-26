import type { DerivedLayout, Landmark } from '../db/types';
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

const LEVEL_M = 0.12; // "level with" a landmark
const NEAR_M = 0.75; // close enough to be a useful reference

/** Numbered placement instructions for a layout's cones, in the parent's units. */
export function coneGuide(layoutId: string, d: DerivedLayout, lengthM: number, widthM: number, landmarks: Landmark[] = [], units: Units = 'metric'): ConeGuide[] {
  const L = (m: number) => fmtLen(Math.abs(m), units);
  return layoutCones(layoutId, d, lengthM).map((c, i) => {
    const [x, y] = c.floor;
    const across = Math.abs(x) < 0.03 ? 'on the centre line' : `${L(widthM / 2 - Math.abs(x))} in from the ${x < 0 ? 'left' : 'right'} side`;
    const parts = [`${L(y)} from the back wall`, across];
    // The side landmark closest along the room, preferring the cone's own side.
    const side = landmarks
      .filter((l) => l.side === 'left' || l.side === 'right')
      .map((l) => ({ l, dy: y - Math.min(lengthM, Math.max(0, l.alongM)), own: (l.side === 'left') === x < 0 }))
      .filter((m) => Math.abs(m.dy) <= NEAR_M)
      .sort((a, b) => Number(b.own) - Number(a.own) || Math.abs(a.dy) - Math.abs(b.dy))[0];
    if (side) {
      parts.push(
        Math.abs(side.dy) <= LEVEL_M
          ? `level with the ${side.l.label.toLowerCase()} (${side.l.side})`
          : `${L(side.dy)} ${side.dy > 0 ? 'nearer the front' : 'nearer the back'} than the ${side.l.label.toLowerCase()} (${side.l.side})`,
      );
    }
    // In line with something on the back or front wall.
    const end = landmarks.filter((l) => (l.side === 'back' || l.side === 'front') && Math.abs(l.alongM - widthM / 2 - x) <= LEVEL_M)[0];
    if (end) parts.push(`in line with the ${end.label.toLowerCase()} on the ${SIDE_TEXT[end.side]}`);
    return { n: i + 1, name: c.name, floor: c.floor, text: parts.join(', ') };
  });
}
