import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { scaledLayout } from '../domain/room';
import { ANIMATED_DRILLS, frameAt, sceneLength, scriptFor } from './drillScripts';

const g = loadProgramme().layoutGeometry;
const rooms = [
  { roomLengthM: 6.1, roomWidthM: 3.0 },
  { roomLengthM: 4.2, roomWidthM: 2.4 },
  { roomLengthM: 7.5, roomWidthM: 3.6 },
  // 14 ft × 6 ft 2 in: the narrow-room versions of L2 and L3.
  { roomLengthM: 4.27, roomWidthM: 1.88 },
];

describe('drill animations', () => {
  for (const r of rooms)
    it(`every animated drill stays inside a ${r.roomLengthM} × ${r.roomWidthM} m room, and shows its cue`, () => {
      const d = scaledLayout({ ...r, floor: 'hard', wallUsable: false, cones: 12 }, g);
      for (const id of ANIMATED_DRILLS) {
        const s = scriptFor(id, d, r.roomLengthM)!;
        expect(s, id).not.toBeNull();
        for (const sc of s.scenes) {
          for (let i = 1; i < sc.keys.length; i++) expect(sc.keys[i].t, `${id} ${sc.title}`).toBeGreaterThan(sc.keys[i - 1].t);
          for (let t = 0; t <= sceneLength(sc); t += 0.1) {
            const k = frameAt(sc, t);
            for (const [x, y] of [k.p, k.b]) {
              expect(Math.abs(x), `${id} ${sc.title} x at ${t}`).toBeLessThanOrEqual(r.roomWidthM / 2);
              expect(y, `${id} ${sc.title} y at ${t}`).toBeGreaterThanOrEqual(0);
              expect(y, `${id} ${sc.title} y at ${t}`).toBeLessThanOrEqual(r.roomLengthM);
            }
          }
          if (id !== 'F2') expect(sc.keys.some((k) => k.cue), `${id} ${sc.title} shows a cue`).toBe(true);
        }
      }
    });

  it('each cue outcome is its own scene, with the cue appearing before the decision', () => {
    const d = scaledLayout({ roomLengthM: 6.1, roomWidthM: 3.0, floor: 'hard', wallUsable: false, cones: 12 }, g);
    expect(scriptFor('F4', d, 6.1)!.scenes.map((s) => s.title)).toEqual(['If the screen says GO', 'If the screen says HELD']);
    expect(scriptFor('F6', d, 6.1)!.scenes).toHaveLength(3);
    const held = scriptFor('F4', d, 6.1)!.scenes[1];
    const cueAt = held.keys.find((k) => k.cue === 'HELD')!.t;
    const feintAt = held.keys.find((k) => /other way/.test(k.caption))!.t;
    expect(cueAt).toBeLessThan(feintAt);
    expect(scriptFor('F1', d, 6.1)).toBeNull();
  });
});
