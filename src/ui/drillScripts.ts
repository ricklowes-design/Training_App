import type { DerivedLayout } from '../db/types';
import { gateInner } from '../domain/layout';

// Scripted drill animations for the drills that combine a move with the app's own cue (no outside video
// shows the whole drill). Room coordinates as in LayoutDiagram: x across (her left is -x when she faces the
// front), y from the back wall toward the front (the Chromebook). Distances come from the room's layout.
// This shows the flow of the drill (where to go, when the cue comes, what each cue asks), not the technique.

export type V = [number, number];
export interface Key {
  t: number; // seconds into the scene
  p: V; // player
  b: V; // ball
  face: V; // facing direction
  lean: number; // -1..1 sideways sell (a fake), + toward +x
  cue: string; // on the screen ('' = blank)
  caption: string;
}
export interface Scene {
  title: string;
  keys: Key[];
}
export interface DrillScript {
  layoutId: string;
  partner?: V;
  target?: V;
  scenes: Scene[];
}

const FRONT: V = [0, 1];
const BACK: V = [0, -1];

/** A scene builder: each step moves from the last key over `dt` seconds; unspecified values carry over. */
function scene(title: string, start: Omit<Key, 't'>) {
  const keys: Key[] = [{ t: 0, ...start }];
  const api = {
    to(dt: number, patch: Partial<Omit<Key, 't'>>) {
      const last = keys[keys.length - 1];
      keys.push({ ...last, ...patch, t: Math.round((last.t + dt) * 100) / 100 });
      return api;
    },
    hold(dt: number) {
      return api.to(dt, {});
    },
    done: (): Scene => ({ title, keys }),
  };
  return api;
}

const lerp = (a: number, b: number, w: number) => a + (b - a) * w;
const lerpV = (a: V, b: V, w: number): V => [lerp(a[0], b[0], w), lerp(a[1], b[1], w)];

/** The state at time t: positions interpolate; the cue and caption switch at their key. */
export function frameAt(s: Scene, t: number): Key {
  const k = s.keys;
  if (t <= 0) return k[0];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].t) {
      const a = k[i - 1];
      const b = k[i];
      const w = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { t, p: lerpV(a.p, b.p, w), b: lerpV(a.b, b.b, w), face: lerpV(a.face, b.face, w), lean: lerp(a.lean, b.lean, w), cue: b.t - t < 1e-6 ? b.cue : a.cue, caption: a.caption === b.caption ? a.caption : w < 0.15 ? a.caption : b.caption };
    }
  }
  return k[k.length - 1];
}

export const sceneLength = (s: Scene) => s.keys[s.keys.length - 1].t;

/** The animation for a drill, sized to the room, or null when the drill has none. */
export function scriptFor(drillId: string, d: DerivedLayout, lengthM: number): DrillScript | null {
  // Feint lane (L2).
  const sy = d.feintStartCone === false ? 0.3 : d.feintStartM ?? 0.5;
  const cy = d.feintConeM;
  const gy = d.feintGateAtM;
  const gx = gateInner(d) + d.feintGateWidthM / 2;
  // Single-cone version: no gates, the exit is past the exit cone on that side.
  const through = (side: string) => (d.singleCone?.includes('L2') ? `past the exit cone on the ${side}` : `through the ${side} gate`);
  const sz = Math.min(lengthM - 0.35, gy + d.feintStopZoneM / 2);
  const lane = (caption: string) => ({ p: [0, sy] as V, b: [0, sy + 0.35] as V, face: FRONT, lean: 0, cue: '', caption });
  const approach = (title: string, caption = 'Dribble at pace toward the feint cone', stopShort = 0.9) =>
    scene(title, lane(caption)).to(1.8, { p: [0, cy - stopShort], b: [0, cy - stopShort + 0.35] });
  // Her left is -x facing the front.
  const exit = (sc: ReturnType<typeof scene>, side: -1 | 1, caption: string) =>
    sc
      .to(0.45, { lean: 0, caption, p: [side * 0.25, cy - 0.35], b: [side * 0.45, cy - 0.05] })
      .to(0.9, { p: [side * gx, gy + 0.05], b: [side * gx, gy + 0.35] })
      .to(0.8, { p: [side * gx, sz - 0.25], b: [side * gx, sz], caption: 'Into the stop zone, two touches at most' })
      .hold(0.9);
  switch (drillId) {
    case 'F2':
      return {
        layoutId: 'L2',
        scenes: ([[-1, 'left'], [1, 'right']] as const).map(([side, name]) =>
          exit(approach(`Exit ${name}`).to(0.5, { lean: -side, caption: `Body feint: sell the ${side < 0 ? 'right' : 'left'}`, p: [-side * 0.08, cy - 0.7] }), side, `Push out ${through(name)}`).done(),
        ),
      };
    case 'F4': {
      const scissors = (title: string, cue: string) =>
        approach(title)
          .to(0.5, { lean: 1, caption: 'Scissors: leg round the ball, selling the right', p: [0.06, cy - 0.75], b: [0, cy - 0.45] })
          .to(0.25, { cue, caption: `The screen says ${cue}` });
      return {
        layoutId: 'L2',
        scenes: [
          exit(scissors('If the screen says GO', 'GO'), -1, 'GO: exit at once with the outside of the other foot').done(),
          exit(scissors('If the screen says HELD', 'HELD').to(0.55, { lean: -1, caption: 'HELD: body feint the other way', p: [-0.08, cy - 0.6] }), 1, 'then exit right').done(),
        ],
      };
    }
    case 'F5':
      return {
        layoutId: 'L2',
        scenes: ([['→', 1, 'right'], ['←', -1, 'left']] as const).map(([arrow, side, name]) =>
          exit(
            approach(`If the arrow points ${name}`, 'Dribble at pace toward the feint cone', 1.2)
              .to(0.2, { cue: arrow, caption: `1 m before the cone the screen shows ${arrow}` })
              .to(0.5, { lean: -side, caption: `Body feint ${side > 0 ? 'left' : 'right'}, away from the arrow`, p: [-side * 0.08, cy - 0.75] }),
            side,
            `Exit ${name}, the arrow side`,
          ).done(),
        ),
      };
    case 'F6': {
      const sell = (title: string, cue: string) =>
        approach(title)
          .to(0.5, { lean: 1, caption: 'Feint: sell the right', p: [0.08, cy - 0.75] })
          .to(0.25, { cue, caption: `The screen says ${cue}` });
      return {
        layoutId: 'L2',
        target: [0, 0.15],
        scenes: [
          exit(sell('If the screen says BIT', 'BIT'), -1, 'BIT: the defender bit, go left').done(),
          exit(sell('If the screen says HELD', 'HELD').to(0.55, { lean: -1, caption: 'HELD: second feint the other way', p: [-0.08, cy - 0.6] }), 1, 'then go right').done(),
          sell('If the screen says BLOCKED', 'BLOCKED')
            .to(0.6, { lean: 0, face: BACK, caption: 'BLOCKED: protect the ball, shield and turn', b: [0, cy - 1.05] })
            .to(0.8, { b: [0, 0.3], caption: 'Release: pass back to the target' })
            .hold(1)
            .done(),
        ],
      };
    }
    case 'D3':
      return {
        layoutId: 'L2',
        scenes: [
          ...([['←', -1, 'left'], ['→', 1, 'right']] as const).map(([arrow, side, name]) =>
            approach(`If the screen shows ${arrow}`, 'Dribble toward the cone, eyes up', 1.2)
              .to(0.25, { cue: arrow, caption: 'Read the cue 1 m out' })
              .to(0.5, { caption: `Cut ${name}, late and sharp`, p: [side * 0.3, cy - 0.5], b: [side * 0.55, cy - 0.25] })
              .to(0.9, { p: [side * gx, gy + 0.05], b: [side * gx, gy + 0.35], caption: `${through(name)[0].toUpperCase()}${through(name).slice(1)}` })
              .hold(0.9)
              .done(),
          ),
          approach('If the screen shows ↑', 'Dribble toward the cone, eyes up', 1.2)
            .to(0.25, { cue: '↑', caption: 'Read the cue 1 m out' })
            .to(0.5, { caption: 'Stop the ball dead', p: [0, cy - 0.85], b: [0, cy - 0.6] })
            .hold(1.2)
            .done(),
        ],
      };
    case 'D4': {
      const n = d.slalomCones ?? 5;
      const sc = scene('Slalom with numbers', { p: [0, Math.max(0.3, d.slalomFirstConeM - 0.5)], b: [0, d.slalomFirstConeM - 0.2], face: FRONT, lean: 0, cue: '', caption: 'Slalom, eyes up to the screen' });
      for (let i = 0; i < n; i++) {
        const y = d.slalomFirstConeM + i * d.slalomSpacingM;
        const x = i % 2 ? 0.28 : -0.28;
        sc.to(0.9, { p: [x, y], b: [x * 1.2, y + 0.25], cue: String([3, 7, 2, 9, 5, 8, 4][i % 7]), caption: 'Call each number out loud as it flashes' });
      }
      sc.to(0.9, { p: [0, lengthM - d.slalomStopZoneM / 2 - 0.2], b: [0, lengthM - d.slalomStopZoneM / 2], cue: '', caption: 'Into the stop zone' }).hold(0.8);
      return { layoutId: 'L1', scenes: [sc.done()] };
    }
  }
  // Receive box (L3): she starts between the box and the screen, facing the back wall; her left is +x then.
  const mid = lengthM / 2;
  const s = d.receiveBoxSideM / 2;
  // Across the room: the box's half-width, or (single-cone version) just beside the line of cones.
  const sx = d.singleCone?.includes('L3') ? 0.12 : s;
  // The narrow-room version keeps exits short: one touch out of the box and stop.
  const exitM = d.singleCone?.includes('L3') ? 0.3 : d.narrow?.includes('L3') ? 0.35 : 0.75;
  const p0: V = [0, mid + s + 0.6];
  const box = (title: string, caption: string) => scene(title, { p: p0, b: [0, mid + s + 0.3], face: BACK, lean: 0, cue: '', caption });
  const push = (sc: ReturnType<typeof scene>) => sc.to(1.0, { b: [0, mid + 0.15], p: [0, mid + s + 0.15], caption: 'Push the ball 2 m into the box and follow it' });
  const look = (sc: ReturnType<typeof scene>, cue: string) =>
    sc.to(0.35, { face: FRONT, caption: 'Look over the shoulder while it rolls' }).to(0.15, { cue }).to(0.3, { face: BACK, caption: `The screen says ${cue}` });
  const out = (sc: ReturnType<typeof scene>, herSide: 'left' | 'right', caption: string) => {
    const x = herSide === 'left' ? 1 : -1;
    return sc
      .to(0.5, { b: [x * (sx + 0.15), mid], p: [x * 0.15, mid + 0.2], caption })
      .to(0.7, { b: [x * (sx + exitM), mid], p: [x * (sx + exitM - 0.35), mid], caption: d.singleCone?.includes('L3') ? `Past the cones on the ${herSide}` : `Through the ${herSide} gate` })
      .hold(0.9);
  };
  switch (drillId) {
    case 'S2':
      return {
        layoutId: 'L3',
        scenes: [
          out(look(push(box('If the screen says LEFT FREE', 'Start between the box and the screen, facing away from it')), 'LEFT FREE'), 'left', 'First touch to the free side').done(),
          look(push(box('If the screen says BOTH BLOCKED', 'Start between the box and the screen, facing away from it')), 'BOTH BLOCKED')
            .to(0.6, { face: FRONT, b: [0, mid + s + 0.2], p: [0, mid + 0.4], caption: 'BOTH BLOCKED: turn back with the ball' })
            .hold(0.9)
            .done(),
        ],
      };
    case 'S4': {
      const partner: V = [0, Math.max(0.3, mid - s - 1.6)];
      return {
        layoutId: 'L3',
        partner,
        scenes: [
          scene('If the screen says RIGHT FREE', { p: [0, mid + 0.2], b: partner, face: BACK, lean: 0, cue: '', caption: 'The parent passes from about 3 m' })
            .to(0.5, { b: [0, mid - 0.4], face: FRONT, caption: 'Look over the shoulder during the pass' })
            .to(0.15, { cue: 'RIGHT FREE' })
            .to(0.35, { face: BACK, b: [0, mid + 0.05], caption: 'Picture before the ball arrives' })
            .to(0.5, { b: [-(sx + 0.2), mid], p: [-0.2, mid + 0.1], caption: 'First touch away from the blocked side' })
            .to(0.7, { b: partner, caption: 'Play it back with the second touch' })
            .hold(0.8)
            .done(),
        ],
      };
    }
    case 'S5': {
      const target: V = [0, 0.2];
      return {
        layoutId: 'L3',
        target,
        scenes: [
          out(look(push(box('If the screen says RIGHT FREE', 'Start between the box and the screen, facing away from it')), 'RIGHT FREE'), 'right', 'Touch to the free side')
            .to(0.6, { b: [-(sx + exitM - 0.25), mid - 0.6], p: [-(sx + exitM - 0.35), mid - 0.3], caption: 'Two dribble touches' })
            .to(0.7, { b: target, caption: 'Short pass into the target with the exit foot' })
            .hold(0.8)
            .done(),
        ],
      };
    }
    case 'C3':
      return {
        layoutId: 'L3',
        scenes: [
          look(push(box('If the screen says BEHIND BLOCKED', 'Receive your own push into the box')), 'BEHIND BLOCKED')
            .to(0.7, { b: [0, mid - s - 0.4], p: [0, mid - s + 0.1], caption: 'BEHIND BLOCKED: touch forward and go' })
            .hold(0.9)
            .done(),
          look(push(box('If the screen says FRONT BLOCKED', 'Receive your own push into the box')), 'FRONT BLOCKED')
            .to(0.5, { b: [0, mid + 0.45], p: [0, mid + 0.25], caption: 'FRONT BLOCKED: drag the ball back' })
            .to(0.6, { face: FRONT, b: [0, mid + s + 0.4], p: [0, mid + s + 0.1], caption: 'and turn away' })
            .hold(0.9)
            .done(),
        ],
      };
  }
  return null;
}

export const ANIMATED_DRILLS = ['F2', 'F4', 'F5', 'F6', 'D3', 'D4', 'S2', 'S4', 'S5', 'C3'];
