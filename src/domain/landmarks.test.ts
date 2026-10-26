import { describe, expect, it } from 'vitest';
import { rankBalls } from '../ball/compare';
import type { Capture } from '../ball/register';
import type { Landmark, Space } from '../db/types';
import { guessPlace, photoFloorPairs, questions, withSpace, workspace } from './space';
import { loadProgramme } from '../test/fixtures';
import { apply, fitError, fitHomography, invert, type H, type P2 } from './homography';
import { coneGuide, landmarkFloor, refPoint } from './landmarks';
import { scaledLayout } from './room';

const g = loadProgramme().layoutGeometry;
const L = 4.27;
const W = 1.88;
const d = scaledLayout({ roomLengthM: L, roomWidthM: W, floor: 'hard', wallUsable: false, cones: 12 }, g);
const marks: Landmark[] = [
  { id: 'door', label: 'Door frame', side: 'right', alongM: 1.7 },
  { id: 'rad', label: 'Radiator', side: 'left', alongM: 3.0 },
  { id: 'shelf', label: 'Bookcase edge', side: 'back', alongM: W / 2 },
];

describe('landmarks', () => {
  it('sit on the edges of the clear floor', () => {
    expect(landmarkFloor(marks[0], L, W)).toEqual([W / 2, 1.7]);
    expect(landmarkFloor(marks[1], L, W)).toEqual([-W / 2, 3.0]);
    expect(landmarkFloor(marks[2], L, W)[1]).toBe(0);
    expect(refPoint('corner:front-left', marks, L, W)!.floor).toEqual([-W / 2, L]);
  });

  it('cone instructions give the distances and the nearest fixed point', () => {
    const guide = coneGuide('L2', d, L, W, marks, 'metric');
    const feint = guide.find((c) => c.name === 'Feint cone')!;
    // Feint cone at 1.7 m: level with the door frame on the right.
    expect(d.feintConeM).toBe(1.7);
    expect(feint.text).toBe('1.7 m from the back wall, on the centre line, level with the door frame (right), in line with the bookcase edge on the back wall');
    const gate = guide.find((c) => c.name === 'Left gate, outer')!;
    expect(gate.text).toBe('2.9 m from the back wall, 0.19 m in from the left side, level with the radiator (left)');
    const shelfCone = guide.find((c) => c.name === 'Right gate, outer')!;
    // Nothing on its own side within reach: the radiator across the room is level with it.
    expect(shelfCone.text).toBe('2.9 m from the back wall, 0.19 m in from the right side, level with the radiator (left)');
    expect(guide.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('without landmarks, cones still get distances', () => {
    expect(coneGuide('L1', d, L, W, [], 'imperial')[0].text).toBe('2 ft 7 in from the back wall, on the centre line');
  });
});

describe('floor map from the photo', () => {
  // A camera at the front looking back and down: a known homography from floor metres to image 0..1.
  const truth: H = [0.25, 0.02, 0.5, 0.01, -0.12, 0.62, 0.0, 0.35, 1];
  const proj = (p: P2) => apply(truth, p)!;
  const floor: P2[] = [
    [-W / 2, 0],
    [W / 2, 0],
    [W / 2, 1.7],
    [-W / 2, 3.0],
    [0, 0.5],
  ];

  it('is recovered from five tapped points, and maps back within a centimetre', () => {
    const h = fitHomography(floor, floor.map(proj))!;
    expect(h).not.toBeNull();
    for (const p of [[0.3, 2.2] as P2, [-0.5, 1.1] as P2]) {
      const [u, v] = apply(h, p)!;
      const [tu, tv] = proj(p);
      expect(Math.abs(u - tu)).toBeLessThan(1e-6);
      expect(Math.abs(v - tv)).toBeLessThan(1e-6);
    }
    expect(fitError(h, floor, floor.map(proj))).toBeLessThan(0.01);
    const back = apply(invert(h)!, proj([0.4, 2.5]))!;
    expect(back[0]).toBeCloseTo(0.4, 6);
    expect(back[1]).toBeCloseTo(2.5, 6);
  });

  it('refuses fewer than four points, or points on one line', () => {
    expect(fitHomography(floor.slice(0, 3), floor.slice(0, 3).map(proj))).toBeNull();
    const line: P2[] = [[0, 0], [0, 1], [0, 2], [0, 3]];
    expect(fitHomography(line, line.map(proj))).toBeNull();
  });

  it('reports a large fit error when a point was tapped in the wrong place', () => {
    const img = floor.map(proj);
    img[4] = [img[4][0] + 0.15, img[4][1]];
    expect(fitError(fitHomography(floor, img)!, floor, img)).toBeGreaterThan(0.05);
  });
});

describe('ball check', () => {
  const px = (h: number, s: number, v: number, n = 60) => Array.from({ length: n }, (_, i) => ({ h: (h + (i % 5) * 0.004) % 1, s, v }));
  const cap = (h: number, s: number, v: number): Capture => ({ kind: 'stationary', pixels: px(h, s, v), diameterPx: 20, y: 0.6 });
  // A brown wooden floor and white walls.
  const room = [...px(0.08, 0.55, 0.45, 700), ...px(0.1, 0.05, 0.92, 300)];

  it('recommends the ball that stands out from the room', () => {
    const r = rankBalls(
      [
        { name: 'White and black ball', captures: [cap(0.1, 0.04, 0.93)], misses: 0 },
        { name: 'Yellow ball', captures: [cap(0.16, 0.85, 0.95), cap(0.16, 0.8, 0.8)], misses: 0 },
        { name: 'Patterned ball', captures: [], misses: 3 },
      ],
      room,
    );
    expect(r.recommended).toBe('Yellow ball');
    expect(r.results.map((x) => x.verdict)).toEqual(['standsOut', 'hard', 'notFound']);
    expect(r.results[1].text).toMatch(/^Hard to follow here: 30% of the room looks like it/);
  });

  it('recommends none when every ball looks like the room', () => {
    expect(rankBalls([{ name: 'Brown ball', captures: [cap(0.08, 0.55, 0.45)], misses: 0 }], room).recommended).toBeUndefined();
  });
});

describe('guided measurement (space)', () => {
  // 14 ft × 9 ft room; a couch along the left wall sticking 0.9 m out, its near end 2.5 m from the back;
  // a bookcase on the back wall, 0.3 m deep, 0.4 m from the left wall; a door frame on the right wall.
  const space: Space = {
    lengthM: 4.27,
    widthM: 2.74,
    items: [
      { id: 'c', label: 'Couch', place: 'left', a: 2.5, b: 1.84, box: { x: 0.02, y: 0.4, w: 0.25, h: 0.3 }, source: 'detected' },
      { id: 'b', label: 'Bookcase', place: 'back', a: 0.4, b: 0.3, box: { x: 0.35, y: 0.15, w: 0.12, h: 0.25 }, source: 'tapped' },
      { id: 'd', label: 'Door frame', place: 'right', a: 1.2, b: 2.74, source: 'typed' },
      { id: 'x', label: 'Not measured', place: 'right', source: 'typed' },
    ],
    backCorners: { left: { x: 0.25, y: 0.35 }, right: { x: 0.75, y: 0.35 } },
  };

  it('asks two measurements worded for where each thing stands', () => {
    expect(questions({ label: 'Couch', place: 'left' })[1].text).toBe('From the couch straight across to the right wall');
    expect(questions({ label: 'Bookcase', place: 'back' })[1].text).toBe('How far the bookcase sticks out from the back wall');
    expect(guessPlace({ x: 0.7, w: 0.2 })).toBe('right');
  });

  it('works out the training space as the room less what sticks out', () => {
    const ws = workspace(space);
    expect(ws).toMatchObject({ x0: 0.9, x1: 2.74, y0: 0.3, lengthM: 3.97, widthM: 1.84 });
    expect(ws.limits).toEqual(['the couch on the left', 'the bookcase at the back']);
    const p = withSpace({ spaceSource: 'parentClass', measured: false } as { spaceSource: string; measured?: boolean; approxUsableM?: { length: number; width: number }; space?: Space }, space);
    expect(p).toMatchObject({ spaceSource: 'approxDims', measured: true, approxUsableM: { length: 3.97, width: 1.84 } });
  });

  it('gives the floor map photo points from the corners and the measured things', () => {
    const pairs = photoFloorPairs(space);
    expect(pairs.map((x) => x.floor.map((v) => Math.round(v * 100) / 100))).toEqual([[0, 0], [2.74, 0], [0.9, 2.5], [0.4, 0.3]]);
    expect(pairs[2].img).toEqual([0.27, 0.7]);
  });

  it('places cones from the real walls, against the measured things', () => {
    const d2 = scaledLayout({ roomLengthM: 3.97, roomWidthM: 1.84, floor: 'hard', wallUsable: false, cones: 12 }, g);
    const guide = coneGuide('L1', d2, 3.97, 1.84, [], 'metric', space);
    // The training space starts 0.3 m out (the bookcase) and is centred 1.82 m from the left wall.
    expect(guide[0].text).toBe('1.1 m from the back wall, 0.92 m from the right wall, level with the door frame (right)');
  });
});
