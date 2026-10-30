import { useEffect, useRef, useState } from 'react';
import type { DerivedLayout, RoomLayout } from '../db/types';
import type { Units } from '../domain/units';
import { frameAt, sceneLength, scriptFor, type V } from './drillScripts';
import { LayoutDiagram } from './LayoutDiagram';

// An animated, top-down demonstration of a drill that combines a move with the app's own cue:
// where the player goes, when the cue appears on the Chromebook, and what each cue asks. Every outcome
// plays in turn; a parent can pick one or pause.

export function DrillAnimation(props: { drillId: string; d: DerivedLayout; lengthM: number; widthM: number; floor?: RoomLayout['floor']; units?: Units; screenBehindM?: number; maxHeight?: number; startScene?: number; freezeAt?: number }) {
  const { drillId, d, lengthM, widthM, floor, units, screenBehindM, maxHeight = 380, startScene = 0, freezeAt } = props;
  const script = scriptFor(drillId, d, lengthM);
  const [scene, setScene] = useState(startScene);
  const [playing, setPlaying] = useState(freezeAt === undefined);
  const [t, setT] = useState(freezeAt ?? 0);
  const last = useRef<number | null>(null);
  const tRef = useRef(t);
  const sceneRef = useRef(scene);
  tRef.current = t;
  sceneRef.current = scene;
  useEffect(() => {
    if (!playing || !script) return;
    let raf = 0;
    const tick = (now: number) => {
      const dt = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      const len = sceneLength(script.scenes[sceneRef.current % script.scenes.length]);
      if (tRef.current + dt > len + 0.6) {
        // The next outcome, after a short pause at the end of this one.
        sceneRef.current = (sceneRef.current + 1) % script.scenes.length;
        tRef.current = 0;
        setScene(sceneRef.current);
      } else tRef.current += dt;
      setT(tRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, drillId, lengthM, widthM]);
  if (!script) return null;
  const sc = script.scenes[scene % script.scenes.length];
  const k = frameAt(sc, t);
  // The ball's path so far, faintly.
  const trail: V[] = [];
  for (let x = 0; x <= Math.min(t, sceneLength(sc)); x += 0.1) trail.push(frameAt(sc, x).b);
  return (
    <div className="stack" style={{ gap: 6 }} data-testid={`drill-animation-${drillId}`}>
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 6 }}>
        <strong>The drill: {sc.title}</strong>
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {script.scenes.length > 1
            ? script.scenes.map((s, i) => (
                <button key={s.title} className="btn small" aria-pressed={i === scene} onClick={() => (setScene(i), setT(0))}>
                  {s.title.replace(/^If the (screen says|arrow points|screen shows) /, '')}
                </button>
              ))
            : null}
          <button className="btn small" onClick={() => setPlaying(!playing)}>
            {playing ? 'Pause' : 'Play'}
          </button>
        </span>
      </div>
      <LayoutDiagram
        layoutId={script.layoutId}
        d={d}
        lengthM={lengthM}
        widthM={widthM}
        floor={floor}
        units={units}
        screenBehindM={screenBehindM}
        maxHeight={maxHeight}
        overlay={({ X, Y, fs, screenY }) => {
          const px = X(k.p[0] + k.lean * 0.1);
          const py = Y(k.p[1]);
          const fl = Math.hypot(k.face[0], k.face[1]) || 1;
          const fx = k.face[0] / fl;
          const fy = k.face[1] / fl;
          return (
            <g>
              {script.partner ? (
                <g>
                  <circle cx={X(script.partner[0])} cy={Y(script.partner[1])} r={0.17} fill="#9ec5ff" />
                  <text x={X(script.partner[0]) + 0.25} y={Y(script.partner[1]) + fs * 0.35} fontSize={fs * 0.85} fill="#9ec5ff">
                    Parent
                  </text>
                </g>
              ) : null}
              {script.target ? <rect x={X(script.target[0]) - 0.45} y={Y(script.target[1]) - 0.08} width={0.9} height={0.16} fill="none" stroke="#3ddc84" strokeWidth={0.05} /> : null}
              {script.target ? (
                <text x={X(script.target[0]) + 0.55} y={Y(script.target[1]) + fs * 0.35} fontSize={fs * 0.8} fill="#9fe6bd">
                  target
                </text>
              ) : null}
              <polyline points={trail.map((b) => `${X(b[0])},${Y(b[1])}`).join(' ')} fill="none" stroke="#e8edf3" strokeWidth={0.03} opacity={0.35} strokeDasharray="0.08 0.08" />
              <circle cx={X(k.b[0])} cy={Y(k.b[1])} r={0.11} fill="#ffffff" stroke="#111" strokeWidth={0.02} />
              <g>
                <circle cx={px} cy={py} r={0.18} fill="#ffd23f" stroke="#111" strokeWidth={0.02} />
                <polygon
                  points={`${px + fx * 0.36},${py - fy * 0.36} ${px + fx * 0.2 - fy * 0.11},${py - fy * 0.2 - fx * 0.11} ${px + fx * 0.2 + fy * 0.11},${py - fy * 0.2 + fx * 0.11}`}
                  fill="#ffd23f"
                />
                {Math.abs(k.lean) > 0.2 ? (
                  <text x={px + Math.sign(k.lean) * 0.32} y={py + fs * 0.3} fontSize={fs} textAnchor="middle" fill="#ffd23f">
                    {k.lean > 0 ? '›' : '‹'}
                  </text>
                ) : null}
              </g>
              {k.cue ? (
                <g>
                  <rect x={X(0) - 0.85} y={Y(screenY) + 0.12} width={1.7} height={0.5} rx={0.06} fill="#0b0f14" stroke="#9ec5ff" strokeWidth={0.03} />
                  <text x={X(0)} y={Y(screenY) + 0.47} fontSize={fs * 1.3} fontWeight={800} textAnchor="middle" fill="#ffffff">
                    {k.cue}
                  </text>
                </g>
              ) : null}
            </g>
          );
        }}
      />
      <div className="note-box" style={{ minHeight: '2.8em' }} aria-live="polite">
        {k.caption}
      </div>
    </div>
  );
}
