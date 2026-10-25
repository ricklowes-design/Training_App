import type { DerivedLayout, RoomLayout } from '../db/types';
import { layoutCones } from '../domain/room';
import { fmtLen, type Units } from '../domain/units';

// Top-down plan of one drill layout in the room (not to an exact scale the parent must match:
// distances are approximate and cones are placed by eye). The front wall, where the Chromebook
// stands, is at the top; the back (start) wall at the bottom. A player facing the Chromebook
// has their left on the left of the drawing.

const FLOOR: Record<RoomLayout['floor'], string> = { hard: '#3b3226', carpet: '#33363d', rubber: '#26302a' };
const CONE = '#ff8a1f';
const OUT = '#ff4d4d';

interface Props {
  layoutId: string;
  d: DerivedLayout;
  lengthM: number;
  widthM: number;
  floor?: RoomLayout['floor'];
  units?: Units;
  /** Scanning layout: how far behind the receive box the screen stands. */
  screenBehindM?: number;
  /** Shown over the drawing when the layout does not fit this room. */
  unavailable?: string;
  maxHeight?: number;
}

export function LayoutDiagram({ layoutId, d, lengthM, widthM, floor = 'hard', units = 'metric', screenBehindM = 1.5, unavailable, maxHeight = 420 }: Props) {
  const L = (m: number) => fmtLen(m, units);
  const padX = 1.3;
  const pad = 0.8;
  const W = widthM + 2 * padX;
  const H = lengthM + 2 * pad;
  // Room metres → drawing: x across from the lane centre (left negative), y along from the back wall.
  const X = (x: number) => padX + widthM / 2 + x;
  const Y = (y: number) => pad + (lengthM - y);
  const fs = Math.max(0.2, Math.min(0.3, Math.max(widthM, lengthM) / 26));
  const cones = layoutCones(layoutId, d, lengthM);
  const inside = (c: [number, number]) => Math.abs(c[0]) <= widthM / 2 && c[1] >= 0 && c[1] <= lengthM;
  const scanning = layoutId === 'L3';
  const boxS = d.receiveBoxSideM / 2;
  const mid = lengthM / 2;
  const screenY = scanning ? Math.min(lengthM - 0.12, mid + boxS + screenBehindM) : lengthM - 0.12;
  const sqS = d.masterySquareM / 2;
  // Where the player starts, and which way they face (1 = toward the front).
  const player: { y: number; face: 1 | -1; label: string } =
    layoutId === 'L1'
      ? { y: Math.max(0.3, d.slalomFirstConeM - 0.5), face: 1, label: 'Start' }
      : layoutId === 'L2'
        ? { y: d.feintStartCone === false ? 0.3 : (d.feintStartM ?? 0.5) - 0.25, face: 1, label: 'Start' }
        : scanning
          ? { y: Math.min(screenY - 0.45, mid + boxS + 0.6), face: -1, label: 'Start,\nback to\nthe screen' }
          : { y: lengthM - 1 - sqS, face: 1, label: 'Player' };
  const camY = scanning ? Math.max(0.25, mid - boxS - 1.0) : null;

  const tri = (x: number, y: number, fill: string, k: number) => {
    const r = 0.13;
    return <polygon key={k} points={`${X(x)},${Y(y) - r} ${X(x) - r * 0.85},${Y(y) + r * 0.6} ${X(x) + r * 0.85},${Y(y) + r * 0.6}`} fill={fill} stroke="#1a1a1a" strokeWidth={0.015} />;
  };
  // Text; "\n" starts a new line.
  const text = (x: number, y: number, s: string, opts: { anchor?: 'start' | 'middle' | 'end'; size?: number; fill?: string; weight?: number } = {}) => (
    <text x={x} y={y} fontSize={opts.size ?? fs} textAnchor={opts.anchor ?? 'middle'} fill={opts.fill ?? '#e8edf3'} fontWeight={opts.weight ?? 400} style={{ fontFamily: 'inherit' }}>
      {s.split('\n').map((line, i) => (
        <tspan key={i} x={x} dy={i ? (opts.size ?? fs) * 1.15 : 0}>
          {line}
        </tspan>
      ))}
    </text>
  );
  const dash = { strokeDasharray: '0.12 0.09', fill: 'none' };

  // Route the player takes, drawn faintly.
  let route: string | null = null;
  if (layoutId === 'L1') {
    const n = d.slalomCones ?? 5;
    const pts = [`M ${X(0)} ${Y(player.y)}`];
    for (let i = 0; i < n; i++) pts.push(`L ${X(i % 2 ? 0.28 : -0.28)} ${Y(d.slalomFirstConeM + i * d.slalomSpacingM)}`);
    pts.push(`L ${X(0)} ${Y(lengthM - d.slalomStopZoneM / 2)}`);
    route = pts.join(' ');
  } else if (layoutId === 'L2') {
    const gx = 0.3 + d.feintGateWidthM / 2;
    route = `M ${X(0)} ${Y(player.y)} L ${X(0)} ${Y(d.feintConeM - 0.35)} M ${X(0)} ${Y(d.feintConeM - 0.35)} Q ${X(-gx)} ${Y(d.feintConeM + 0.2)} ${X(-gx)} ${Y(d.feintGateAtM + 0.4)} M ${X(0)} ${Y(d.feintConeM - 0.35)} Q ${X(gx)} ${Y(d.feintConeM + 0.2)} ${X(gx)} ${Y(d.feintGateAtM + 0.4)}`;
  } else if (scanning) {
    route = `M ${X(0)} ${Y(player.y - 0.2)} L ${X(0)} ${Y(mid)} M ${X(0)} ${Y(mid)} L ${X(-boxS - 0.45)} ${Y(mid)} M ${X(0)} ${Y(mid)} L ${X(boxS + 0.45)} ${Y(mid)}`;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight, display: 'block' }} role="img" aria-label={`${layoutId} layout from above`} data-testid={`layout-diagram-${layoutId}`}>
      <rect x={0} y={0} width={W} height={H} fill="#11161d" rx={0.1} />
      {/* Room */}
      <rect x={X(-widthM / 2)} y={Y(lengthM)} width={widthM} height={lengthM} fill={FLOOR[floor]} stroke="#c8d2de" strokeWidth={0.04} />
      {text(W / 2, Y(lengthM) - 0.32, 'FRONT', { weight: 700, size: fs * 1.05 })}
      {text(W / 2, Y(0) + 0.38, 'BACK (start wall)', { weight: 700, size: fs * 1.05 })}
      {/* Room size */}
      {text(W / 2, Y(0) + 0.66, `${L(widthM)} wide`, { size: fs * 0.85, fill: '#a9b4c2' })}
      <text x={X(-widthM / 2) - 0.2} y={Y(lengthM / 2)} fontSize={fs * 0.85} fill="#a9b4c2" textAnchor="middle" transform={`rotate(-90 ${X(-widthM / 2) - 0.2} ${Y(lengthM / 2)})`}>
        {`${L(lengthM)} long`}
      </text>

      {/* Stop zones */}
      {layoutId === 'L1' ? <rect x={X(-0.5)} y={Y(lengthM)} width={1} height={d.slalomStopZoneM} fill="#3ddc84" opacity={0.18} /> : null}
      {layoutId === 'L1' ? text(X(-0.55), Y(lengthM - d.slalomStopZoneM / 2) + fs * 0.35, 'stop\nzone', { anchor: 'end', size: fs * 0.8, fill: '#9fe6bd' }) : null}
      {layoutId === 'L2' ? <rect x={X(-widthM / 2 + 0.05)} y={Y(Math.min(lengthM, d.feintGateAtM + d.feintStopZoneM))} width={widthM - 0.1} height={Math.min(d.feintStopZoneM, lengthM - d.feintGateAtM)} fill="#3ddc84" opacity={0.15} /> : null}
      {layoutId === 'L2' ? text(X(0), Y(d.feintGateAtM + d.feintStopZoneM / 2) + fs * 0.35, 'stop zone', { size: fs * 0.8, fill: '#9fe6bd' }) : null}

      {/* Gates */}
      {layoutId === 'L2'
        ? [-1, 1].map((s) => <line key={s} x1={X(s * 0.3)} y1={Y(d.feintGateAtM)} x2={X(s * (0.3 + d.feintGateWidthM))} y2={Y(d.feintGateAtM)} stroke="#3ddc84" strokeWidth={0.05} {...dash} />)
        : null}
      {scanning ? (
        <>
          <rect x={X(-boxS)} y={Y(mid + boxS)} width={2 * boxS} height={2 * boxS} fill="none" stroke="#e8edf3" strokeWidth={0.025} opacity={0.6} />
          {[-1, 1].map((s) => (
            <line key={s} x1={X(s * boxS)} y1={Y(mid - d.receiveGateWidthM / 2)} x2={X(s * boxS)} y2={Y(mid + d.receiveGateWidthM / 2)} stroke="#3ddc84" strokeWidth={0.06} {...dash} />
          ))}
        </>
      ) : null}
      {layoutId === 'L4' ? <rect x={X(-sqS)} y={Y(lengthM - 1)} width={2 * sqS} height={2 * sqS} fill="none" stroke="#e8edf3" strokeWidth={0.025} opacity={0.6} /> : null}

      {route ? <path d={route} stroke="#ffd23f" strokeWidth={0.035} opacity={0.75} {...dash} /> : null}

      {/* Cones */}
      {cones.map((c, i) => tri(c.floor[0], c.floor[1], inside(c.floor) ? CONE : OUT, i))}

      {/* Key distances */}
      {layoutId === 'L1' ? (
        <>
          {text(X(0.42), Y(d.slalomFirstConeM) + fs * 0.35, `${L(d.slalomFirstConeM)} from back`, { anchor: 'start', size: fs * 0.8 })}
          {(d.slalomCones ?? 5) > 1 ? text(X(0.42), Y(d.slalomFirstConeM + d.slalomSpacingM) + fs * 0.35, `${L(d.slalomSpacingM)} apart`, { anchor: 'start', size: fs * 0.8 }) : null}
        </>
      ) : null}
      {layoutId === 'L2' ? (
        <>
          {text(X(0.2), Y(d.feintConeM) + fs * 0.35, `feint cone\n${L(d.feintConeM)} from back`, { anchor: 'start', size: fs * 0.8 })}
          {text(X(0), Y(d.feintGateAtM) + fs * 1.3, `gates ${L(d.feintGateWidthM)} wide at ${L(d.feintGateAtM)}`, { size: fs * 0.8 })}
        </>
      ) : null}
      {scanning ? text(X(0), Y(mid - boxS) + fs * 1.2, `${L(d.receiveBoxSideM)} box, ${L(d.receiveGateWidthM)} gates`, { size: fs * 0.8 }) : null}
      {layoutId === 'L4' ? text(X(sqS + 0.15), Y(lengthM - 1 - sqS) + fs * 0.35, `${L(d.masterySquareM)} square`, { anchor: 'start', size: fs * 0.8 }) : null}

      {/* Chromebook on its stand */}
      <g>
        <rect x={X(-0.25)} y={Y(screenY) - 0.06} width={0.5} height={0.12} rx={0.02} fill="#9ec5ff" stroke="#e8edf3" strokeWidth={0.02} />
        <line x1={X(0)} y1={Y(screenY) + 0.06} x2={X(0)} y2={Y(screenY) + 0.16} stroke="#e8edf3" strokeWidth={0.03} />
        {text(X(0.32), Y(screenY) + fs * 0.35, scanning ? 'Chromebook\n(behind the player)' : 'Chromebook', { anchor: 'start', size: fs * 0.85, fill: '#9ec5ff', weight: 700 })}
        {!scanning ? text(X(0.32), Y(screenY) + fs * 1.3, 'webcam on top', { anchor: 'start', size: fs * 0.7, fill: '#a9b4c2' }) : null}
      </g>
      {camY !== null ? (
        <g>
          <rect x={X(-0.1)} y={Y(camY) - 0.07} width={0.2} height={0.14} rx={0.03} fill="#a9b4c2" />
          <circle cx={X(0)} cy={Y(camY)} r={0.045} fill="#11161d" />
          {text(X(0.2), Y(camY) + fs * 0.35, 'webcam, low,\nfacing the player', { anchor: 'start', size: fs * 0.75, fill: '#a9b4c2' })}
        </g>
      ) : null}

      {/* Player */}
      <g>
        <circle cx={X(0)} cy={Y(player.y)} r={0.17} fill="#ffd23f" stroke="#111" strokeWidth={0.02} />
        <polygon points={`${X(0)},${Y(player.y + player.face * 0.36)} ${X(-0.1)},${Y(player.y + player.face * 0.2)} ${X(0.1)},${Y(player.y + player.face * 0.2)}`} fill="#ffd23f" />
        {text(X(-0.25), Y(player.y) + fs * 0.35, player.label, { anchor: 'end', size: fs * 0.85, fill: '#ffd23f', weight: 700 })}
      </g>

      {unavailable ? (
        <g>
          <rect x={0} y={H / 2 - 0.45} width={W} height={0.9} fill="#000" opacity={0.7} />
          {text(W / 2, H / 2 + fs * 0.35, 'Not available in this room', { fill: '#ffb020', weight: 700 })}
        </g>
      ) : null}
    </svg>
  );
}

/** The symbols used in the diagrams. */
export function LayoutLegend() {
  const item = (svg: JSX.Element, label: string) => (
    <span className="row" style={{ gap: 6 }}>
      <svg viewBox="0 0 1 1" width={16} height={16}>
        {svg}
      </svg>
      <span className="muted">{label}</span>
    </span>
  );
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
      {item(<polygon points="0.5,0.08 0.08,0.9 0.92,0.9" fill={CONE} />, 'cone')}
      {item(<polygon points="0.5,0.08 0.08,0.9 0.92,0.9" fill={OUT} />, 'cone outside the clear floor')}
      {item(<circle cx={0.5} cy={0.5} r={0.4} fill="#ffd23f" />, 'player (arrow: facing)')}
      {item(<rect x={0.05} y={0.3} width={0.9} height={0.4} fill="#9ec5ff" />, 'Chromebook on its stand')}
      {item(<line x1={0} y1={0.5} x2={1} y2={0.5} stroke="#3ddc84" strokeWidth={0.2} strokeDasharray="0.2 0.12" />, 'gate')}
      {item(<line x1={0} y1={0.5} x2={1} y2={0.5} stroke="#ffd23f" strokeWidth={0.15} strokeDasharray="0.2 0.12" />, 'route')}
    </div>
  );
}
