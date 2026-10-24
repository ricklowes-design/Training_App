import { describe, expect, it } from 'vitest';
import type { Gray } from './frames';
import { ROOM_H, ROOM_W, roomConsistency } from './roomCheck';

/** A textured synthetic room: smooth gradients plus a few distinct "furniture" blocks. */
function scene(dx = 0, dy = 0, hide?: { x: number; y: number }): Gray {
  const data = new Uint8Array(ROOM_W * ROOM_H);
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const X = x - dx;
      const Y = y - dy;
      let v = 90 + 40 * Math.sin(X / 7) * Math.cos(Y / 5) + ((X * 13 + Y * 7) % 23);
      if (X > 15 && X < 30 && Y > 10 && Y < 30) v = 200 - ((X * 5) % 30); // desk
      if (X > 90 && X < 110 && Y > 5 && Y < 40) v = 40 + ((Y * 9) % 40); // bookcase
      if (hide && Math.abs(x - hide.x) < 9 && Math.abs(y - hide.y) < 9) v = 128; // something in front
      data[y * ROOM_W + x] = Math.max(0, Math.min(255, v));
    }
  }
  return { w: ROOM_W, h: ROOM_H, data };
}

const anchors = [
  { id: 'a', label: 'desk corner', pt: { x: 16 / 127, y: 11 / 71 } },
  { id: 'b', label: 'bookcase edge', pt: { x: 91 / 127, y: 20 / 71 } },
  { id: 'c', label: 'wall texture', pt: { x: 60 / 127, y: 50 / 71 } },
];

describe('session-launch room check (task 1.3)', () => {
  it('matched: same picture → reuse the saved set-up', () => {
    const r = roomConsistency(scene(), scene(), anchors);
    expect(r.status).toBe('matched');
    expect(r.matched).toBe(3);
  });

  it('a small nudge still matches', () => {
    expect(roomConsistency(scene(), scene(1, 1), anchors).status).toBe('matched');
  });

  it('partly obstructed: one anchor hidden → use the visible ones with uncertainty', () => {
    const r = roomConsistency(scene(), scene(0, 0, { x: 91, y: 20 }), anchors);
    expect(r.status).toBe('partial');
    expect(r.matched).toBe(2);
  });

  it('moved: a deliberate camera move is caught', () => {
    const r = roomConsistency(scene(), scene(9, 6), anchors);
    expect(r.status).toBe('moved');
    expect(r.message).toMatch(/camera-unverified/);
  });

  it('too dark is reported as unusable, not as a move', () => {
    const dark = { ...scene(), data: scene().data.map((v) => v / 6) };
    expect(roomConsistency(scene(), dark, anchors).status).toBe('unusable');
  });

  it('without anchors the whole-picture check decides', () => {
    expect(roomConsistency(scene(), scene(), []).status).toBe('matched');
  });
});
