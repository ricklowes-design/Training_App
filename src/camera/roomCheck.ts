import type { Pt, RoomAnchor } from '../db/types';
import { bestShift, meanBrightness, ncc, type Gray } from './frames';

// Session-launch consistency check (task 1.3, part 16 §2). Compares the live picture with
// the room profile's saved photo: the whole picture for a camera move, and a small patch
// round each labelled anchor (desk corner, bookcase edge…) for obstruction. Runs before
// the first block, never during one.

export const ROOM_W = 128;
export const ROOM_H = 72;

export type RoomCheckStatus = 'matched' | 'partial' | 'moved' | 'unusable';

export interface RoomCheck {
  status: RoomCheckStatus;
  matched: number;
  total: number;
  shift: { dx: number; dy: number };
  message: string;
}

export const ROOM_CHECK = {
  minBrightness: 45,
  maxBrightness: 220,
  globalSimilarity: 0.55,
  maxShiftCells: 4, // of 128×72 ≈ 3% of the picture
  anchorSimilarity: 0.7,
  patchRadius: 5,
  anchorSearch: 3,
};

function patch(g: Gray, cx: number, cy: number, r: number): Gray | null {
  if (cx - r < 0 || cy - r < 0 || cx + r >= g.w || cy + r >= g.h) return null;
  const w = 2 * r + 1;
  const data = new Uint8Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) data[y * w + x] = g.data[(cy - r + y) * g.w + (cx - r + x)];
  return { w, h: w, data };
}

/** Best similarity of the anchor's patch in the live picture within a small search round its expected place. */
export function anchorScore(ref: Gray, now: Gray, pt: Pt, shift: { dx: number; dy: number }): number {
  const r = ROOM_CHECK.patchRadius;
  const cx = Math.round(pt.x * (ref.w - 1));
  const cy = Math.round(pt.y * (ref.h - 1));
  const a = patch(ref, cx, cy, r);
  if (!a) return 0;
  let best = -1;
  for (let dy = -ROOM_CHECK.anchorSearch; dy <= ROOM_CHECK.anchorSearch; dy++) {
    for (let dx = -ROOM_CHECK.anchorSearch; dx <= ROOM_CHECK.anchorSearch; dx++) {
      const b = patch(now, cx + shift.dx + dx, cy + shift.dy + dy, r);
      if (b) best = Math.max(best, ncc(a, b));
    }
  }
  return best;
}

export function roomConsistency(ref: Gray, now: Gray, anchors: RoomAnchor[]): RoomCheck {
  const b = meanBrightness(now);
  const base = { matched: 0, total: anchors.length, shift: { dx: 0, dy: 0 } };
  if (b < ROOM_CHECK.minBrightness) return { ...base, status: 'unusable', message: 'Too dark for the camera: turn on another light.' };
  if (b > ROOM_CHECK.maxBrightness) return { ...base, status: 'unusable', message: 'Too bright for the camera: close a curtain.' };
  const shift = bestShift(ref, now, 10);
  const still = Math.abs(shift.dx) <= ROOM_CHECK.maxShiftCells && Math.abs(shift.dy) <= ROOM_CHECK.maxShiftCells && shift.score >= ROOM_CHECK.globalSimilarity;
  const s = { dx: shift.dx, dy: shift.dy };
  if (!still) {
    return { ...base, shift: s, status: 'moved', message: 'The camera has moved since the room profile was saved. A parent can re-confirm it, or the session runs camera-unverified.' };
  }
  const matched = anchors.filter((a) => anchorScore(ref, now, a.pt, s) >= ROOM_CHECK.anchorSimilarity).length;
  if (anchors.length === 0 || matched === anchors.length) return { status: 'matched', matched, total: anchors.length, shift: s, message: 'Room set-up matches the saved profile.' };
  if (matched >= Math.ceil(anchors.length / 2)) {
    return { status: 'partial', matched, total: anchors.length, shift: s, message: `${anchors.length - matched} of ${anchors.length} room anchors hidden: using the visible ones, with lower confidence.` };
  }
  return { status: 'moved', matched, total: anchors.length, shift: s, message: 'Most room anchors are hidden or moved. A parent can re-confirm the profile, or the session runs camera-unverified.' };
}
