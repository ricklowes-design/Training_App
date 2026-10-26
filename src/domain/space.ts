import type { ItemPlace, Space, SpaceItem } from '../db/types';
import type { P2 } from './homography';

// The guided measurement (parent request 2026-10-26): measure the room, photograph it from the
// Chromebook, then measure from the things in the photo. From those the app works out the clear
// training space, the reference points cones are placed against, and the floor map.
// Wall coordinates: x from the left wall (facing the Chromebook from the back), y from the back wall.

export interface Question {
  key: 'a' | 'b';
  text: string;
}

const lc = (s: string) => s.trim().toLowerCase() || 'it';

/** The two measurements asked for each thing, worded for where it stands. */
export function questions(item: Pick<SpaceItem, 'label' | 'place'>): [Question, Question] {
  const n = lc(item.label);
  switch (item.place) {
    case 'left':
    case 'right':
      return [
        { key: 'a', text: `From the back wall to the near end of the ${n} (the end nearest the Chromebook)` },
        { key: 'b', text: `From the ${n} straight across to the ${item.place === 'left' ? 'right' : 'left'} wall` },
      ];
    case 'back':
      return [
        { key: 'a', text: `From the left wall to the ${n}` },
        { key: 'b', text: `How far the ${n} sticks out from the back wall` },
      ];
    case 'inRoom':
      return [
        { key: 'a', text: `From the back wall to the ${n}` },
        { key: 'b', text: `From the left wall to the ${n}` },
      ];
  }
}

/** A first guess at where a thing in the photo stands, from where its box is (camera at the front, looking back). */
export function guessPlace(box: { x: number; w: number }): ItemPlace {
  const cx = box.x + box.w / 2;
  return cx < 0.33 ? 'left' : cx > 0.67 ? 'right' : 'back';
}

const measured = (i: SpaceItem) => i.a !== undefined && i.b !== undefined && Number.isFinite(i.a) && Number.isFinite(i.b);

export interface Workspace {
  /** The clear rectangle, in wall coordinates. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  lengthM: number;
  widthM: number;
  /** What narrowed it, for the summary. */
  limits: string[];
}

/** The clear training space: the room less whatever sticks out from the side and back walls. */
export function workspace(s: Space): Workspace {
  let x0 = 0;
  let x1 = s.widthM;
  let y0 = 0;
  const limits: string[] = [];
  for (const i of s.items.filter(measured)) {
    if (i.place === 'left' && s.widthM - i.b! > x0) {
      x0 = s.widthM - i.b!;
      limits.push(`the ${lc(i.label)} on the left`);
    } else if (i.place === 'right' && i.b! < x1) {
      x1 = i.b!;
      limits.push(`the ${lc(i.label)} on the right`);
    } else if (i.place === 'back' && i.b! > y0) {
      y0 = i.b!;
      limits.push(`the ${lc(i.label)} at the back`);
    }
  }
  x1 = Math.max(x0, x1);
  y0 = Math.min(y0, s.lengthM);
  const r = (x: number) => Math.round(x * 100) / 100;
  return { x0: r(x0), x1: r(x1), y0: r(y0), y1: r(s.lengthM), lengthM: r(s.lengthM - y0), widthM: r(x1 - x0), limits };
}

export interface Ref {
  label: string;
  at: P2; // wall coordinates
  /** Short side note for the cone text, e.g. "left". */
  side?: string;
}

/** The point of each measured thing that cones are placed against. */
export function spaceRefs(s: Space): Ref[] {
  return s.items.filter(measured).map((i) => {
    switch (i.place) {
      case 'left':
        return { label: lc(i.label), at: [s.widthM - i.b!, i.a!] as P2, side: 'left' };
      case 'right':
        return { label: lc(i.label), at: [i.b!, i.a!] as P2, side: 'right' };
      case 'back':
        return { label: lc(i.label), at: [i.a!, i.b!] as P2, side: 'back' };
      case 'inRoom':
        return { label: lc(i.label), at: [i.b!, i.a!] as P2 };
    }
  });
}

/** Rough footprints for the plan (wall coordinates [x0, y0, x1, y1]); depth along the wall is not measured, so it is drawn short. */
export function footprints(s: Space): { label: string; rect: [number, number, number, number] }[] {
  const DEPTH = 0.8;
  return s.items.filter(measured).flatMap((i) => {
    const label = i.label.trim() || 'item';
    switch (i.place) {
      case 'left':
        return [{ label, rect: [0, Math.max(0, i.a! - DEPTH), s.widthM - i.b!, i.a!] as [number, number, number, number] }];
      case 'right':
        return [{ label, rect: [i.b!, Math.max(0, i.a! - DEPTH), s.widthM, i.a!] as [number, number, number, number] }];
      case 'back':
        return [{ label, rect: [i.a!, 0, Math.min(s.widthM, i.a! + DEPTH), i.b!] as [number, number, number, number] }];
      case 'inRoom':
        return [];
    }
  });
}

/** Photo ↔ floor pairs for the floor map: the back corners, and the floor point of each thing measured from the photo. */
export function photoFloorPairs(s: Space): { img: P2; floor: P2 }[] {
  const out: { img: P2; floor: P2 }[] = [];
  if (s.backCorners?.left) out.push({ img: [s.backCorners.left.x, s.backCorners.left.y], floor: [0, 0] });
  if (s.backCorners?.right) out.push({ img: [s.backCorners.right.x, s.backCorners.right.y], floor: [s.widthM, 0] });
  for (const i of s.items.filter((x) => measured(x) && x.box)) {
    const b = i.box!;
    const bottom = b.y + b.h;
    // The corner of its box that is nearest the middle of the room, where it meets the floor.
    switch (i.place) {
      case 'left':
        out.push({ img: [b.x + b.w, bottom], floor: [s.widthM - i.b!, i.a!] });
        break;
      case 'right':
        out.push({ img: [b.x, bottom], floor: [i.b!, i.a!] });
        break;
      case 'back':
        out.push({ img: [b.x, bottom], floor: [i.a!, i.b!] });
        break;
      case 'inRoom':
        out.push({ img: [b.x + b.w / 2, bottom], floor: [i.b!, i.a!] });
        break;
    }
  }
  return out;
}

/** A profile with its guided measurement applied: the drills scale to the training space. */
export function withSpace<T extends { space?: Space; spaceSource: string; measured?: boolean; approxUsableM?: { length: number; width: number } }>(p: T, space: Space): T {
  const ws = workspace(space);
  return { ...p, space, spaceSource: 'approxDims', measured: true, approxUsableM: { length: ws.lengthM, width: ws.widthM } };
}
