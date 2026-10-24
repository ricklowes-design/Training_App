import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { classFromDims, effectiveDims, layoutFit, layoutFromProfile, newProfile, polygonDims, profileChanged, profileClass, roomInputFor, scaledLayout, suggestPoint } from './room';

const p = loadProgramme();
const g = p.layoutGeometry;
const now = '2026-10-15T10:00:00.000Z';
const fits = (prof: ReturnType<typeof newProfile>) => {
  const d = scaledLayout(roomInputFor(prof, 12), g);
  return Object.fromEntries(['L1', 'L2', 'L3', 'L4'].map((l) => [l, layoutFit(l, d, g).ok]));
};

describe('room profiles (part 15 D1)', () => {
  it('needs no measuring: a class alone gives a usable geometry for every layout', () => {
    for (const c of ['compact', 'standard', 'extended'] as const) {
      const prof = { ...newProfile('r', 'Room', now), usableSpaceClass: c };
      expect(fits(prof)).toEqual({ L1: true, L2: true, L3: true, L4: true });
    }
  });

  it('a compact room gets fewer slalom cones rather than cramped spacing', () => {
    const d = scaledLayout(roomInputFor({ ...newProfile('r', 'Room', now), usableSpaceClass: 'compact' }, 12), g);
    expect(d.slalomCones).toBeLessThan(g.slalom.cones);
    expect(d.slalomSpacingM).toBeGreaterThanOrEqual(g.slalom.minSpacingM);
  });

  it('classes from approximate dimensions', () => {
    expect(classFromDims(4, 2.4)).toBe('compact');
    expect(classFromDims(6.1, 3)).toBe('standard');
    expect(classFromDims(8, 4)).toBe('extended');
  });

  it('shrinking the safe polygon excludes the drills that no longer fit', () => {
    const big = { ...newProfile('r', 'Room', now), spaceSource: 'polygon' as const, safePolygonNormalized: [{ x: 0.1, y: 0.95 }, { x: 0.9, y: 0.95 }, { x: 0.8, y: 0.4 }, { x: 0.2, y: 0.4 }] };
    expect(fits(big)).toEqual({ L1: true, L2: true, L3: true, L4: true });
    const small = { ...big, safePolygonNormalized: [{ x: 0.35, y: 0.95 }, { x: 0.65, y: 0.95 }, { x: 0.6, y: 0.72 }, { x: 0.4, y: 0.72 }] };
    const f = fits(small);
    expect(f.L2).toBe(false);
    expect(f.L3).toBe(false);
    expect(f.L4).toBe(true);
    expect(layoutFit('L2', scaledLayout(roomInputFor(small, 12), g), g).reason).toMatch(/clear length/);
    expect(profileClass(small)).toBe('compact');
    expect(polygonDims(small.safePolygonNormalized).length).toBeLessThan(polygonDims(big.safePolygonNormalized).length);
  });

  it('approximate dimensions win over the polygon when the parent chose them', () => {
    const prof = { ...newProfile('r', 'Room', now), spaceSource: 'approxDims' as const, approxUsableM: { length: 6.1, width: 3 }, safePolygonNormalized: [{ x: 0.4, y: 0.9 }, { x: 0.6, y: 0.9 }, { x: 0.5, y: 0.8 }] };
    expect(effectiveDims(prof)).toEqual({ length: 6.1, width: 3 });
  });

  it('a new layout version only when the geometry changes', () => {
    const prof = newProfile('r', 'Room', now);
    const l1 = layoutFromProfile(prof, undefined, 12, g)!;
    expect(l1.version).toBe(1);
    expect(l1.roomProfileId).toBe('r');
    expect(layoutFromProfile({ ...prof, name: 'Renamed' }, l1, 12, g)).toBeNull();
    expect(layoutFromProfile({ ...prof, usableSpaceClass: 'compact' }, l1, 12, g)?.version).toBe(2);
  });

  it('profile versions change with the polygon, anchors or space, not the name', () => {
    const a = newProfile('r', 'Room', now);
    expect(profileChanged(a, { ...a, name: 'Lounge' })).toBe(false);
    expect(profileChanged(a, { ...a, anchors: [{ id: '1', label: 'desk', pt: { x: 0.1, y: 0.2 } }] })).toBe(true);
    expect(profileChanged(a, { ...a, safePolygonNormalized: [{ x: 0, y: 0 }] })).toBe(true);
  });

  it('suggested cones sit inside the polygon box, the start wall far from the camera', () => {
    const poly = [{ x: 0.2, y: 0.95 }, { x: 0.8, y: 0.95 }, { x: 0.7, y: 0.4 }, { x: 0.3, y: 0.4 }];
    const far = suggestPoint(poly, 6, 3, [0, 0.5]);
    const near = suggestPoint(poly, 6, 3, [0, 5.5]);
    expect(far.y).toBeLessThan(near.y);
    for (const q of [far, near]) {
      expect(q.x).toBeGreaterThanOrEqual(0.2);
      expect(q.x).toBeLessThanOrEqual(0.8);
      expect(q.y).toBeGreaterThanOrEqual(0.4);
      expect(q.y).toBeLessThanOrEqual(0.95);
    }
  });
});
