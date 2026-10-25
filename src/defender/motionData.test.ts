import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The committed defender motion data (assets/defender-motion) keeps its format.

type Take = { format: string; fps: number; frameCount: number; units: string; joints: string[]; frames: number[][] };
const load = (name: string) => JSON.parse(readFileSync(resolve(__dirname, '../../assets/defender-motion', name), 'utf8')) as Take;
const at = (t: Take, f: number, joint: string) => {
  const j = t.joints.indexOf(joint) * 3;
  return { x: t.frames[f][j], y: t.frames[f][j + 1], z: t.frames[f][j + 2] };
};

describe('defender motion data', () => {
  for (const [name, frames] of [['take1.json', 458], ['take2.json', 2692]] as const) {
    it(`${name}: 19 joints in millimetres at 30 fps, feet on the floor, facing the camera`, () => {
      const t = load(name);
      expect(t.format).toBe('defender-motion/1');
      expect(t.fps).toBe(30);
      expect(t.units).toBe('mm');
      expect(t.joints).toHaveLength(19);
      expect(t.frameCount).toBe(frames);
      expect(t.frames).toHaveLength(frames);
      for (let f = 0; f < t.frameCount; f++) {
        expect(t.frames[f]).toHaveLength(57);
        const feet = ['leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftToe', 'rightToe'].map((j) => at(t, f, j).y);
        expect(Math.min(...feet)).toBe(0);
        const head = at(t, f, 'nose').y;
        expect(head).toBeGreaterThan(900);
        expect(head).toBeLessThan(2000);
      }
      // Facing the camera: the performer's left hip is on the camera's right in most frames.
      const facing = t.frames.filter((_, f) => at(t, f, 'leftHip').x > at(t, f, 'rightHip').x).length / t.frameCount;
      expect(facing).toBeGreaterThan(0.9);
    });
  }
});
