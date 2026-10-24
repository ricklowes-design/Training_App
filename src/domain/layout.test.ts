import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { deriveLayout, nextLayout, roomChanged } from './layout';

const g = loadProgramme().layoutGeometry;
const room = { roomLengthM: 6.1, roomWidthM: 3.0, floor: 'hard' as const, wallUsable: false, cones: 12 };

describe('room layouts (plan/03 §3.3)', () => {
  it('the default 6.1 × 3.0 m room gives the plan layouts', () => {
    const d = deriveLayout(room, g);
    expect(d.slalomSpacingM).toBe(1.0);
    expect(d.feintConeM).toBe(3.0);
    expect(d.feintGateAtM).toBe(4.2);
    expect(d.receiveBoxSideM).toBe(1.5);
  });

  it('changing room length changes slalom spacing and increments the layout version', () => {
    const v1 = nextLayout(undefined, room, g);
    const shorter = { ...room, roomLengthM: 5.0 };
    expect(roomChanged(v1, shorter)).toBe(true);
    const v2 = nextLayout(v1, shorter, g);
    expect(v2.version).toBe(2);
    expect(v2.derived.slalomSpacingM).toBeLessThan(1.0);
    expect(roomChanged(v2, shorter)).toBe(false);
  });
});
