import { useEffect, useRef, useState } from 'react';
import type { DefenderPose } from './stateMachine';

// Player-perspective defender view (task 2.2). Loads Three.js only when a defender block
// starts. If WebGL is missing or the frame rate stays too low, it switches to the 2D
// fallback and reports it, so the block is recorded as "fallback2d", never as 3D.

export const MIN_FPS = 20;

export function Defender3D({ getPose, onFallback, onFps }: { getPose: () => DefenderPose; onFallback: (reason: string) => void; onFps?: (fps: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cb = useRef({ getPose, onFallback, onFps });
  cb.current = { getPose, onFallback, onFps };
  useEffect(() => {
    let stop = false;
    let raf = 0;
    let dispose: (() => void) | undefined;
    (async () => {
      let scene: import('./scene').DefenderScene;
      try {
        const mod = await import('./scene');
        if (stop || !canvas.current) return;
        scene = mod.createDefenderScene(canvas.current);
      } catch (e) {
        cb.current.onFallback(`3D could not start (${e instanceof Error ? e.message : String(e)})`);
        return;
      }
      dispose = () => scene.dispose();
      let size = '';
      const fit = () => {
        const c = canvas.current;
        if (!c) return;
        const now = `${c.clientWidth}x${c.clientHeight}`;
        if (now === size) return;
        size = now;
        scene.resize(c.clientWidth, c.clientHeight);
      };
      fit();
      window.addEventListener('resize', fit);
      const started = performance.now();
      let frames = 0;
      let windowStart = started;
      const loop = () => {
        if (stop) return;
        fit(); // the layout can settle after the scene starts
        scene.render(cb.current.getPose());
        frames++;
        const now = performance.now();
        if (now - windowStart >= 2000) {
          const fps = Math.round((frames * 1000) / (now - windowStart));
          cb.current.onFps?.(fps);
          // Judge after a short warm-up; a slow device falls back rather than show a stuttering defender.
          if (now - started > 3000 && fps < MIN_FPS) {
            cb.current.onFallback(`3D ran at ${fps} fps (below ${MIN_FPS})`);
            return;
          }
          frames = 0;
          windowStart = now;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      const prevDispose = dispose;
      dispose = () => {
        window.removeEventListener('resize', fit);
        prevDispose();
      };
    })();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      dispose?.();
    };
  }, []);
  return <canvas ref={canvas} className="defender-canvas" data-testid="defender-3d" />;
}

/** The 2D fallback: a flat front view drawn from the same pose. Labelled wherever it is used. */
export function Defender2D({ getPose }: { getPose: () => DefenderPose }) {
  const [pose, setPose] = useState<DefenderPose>(getPose());
  const cb = useRef(getPose);
  cb.current = getPose;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setPose(cb.current());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  // Simple perspective: size ∝ 1/z; x across the screen.
  const s = 2.2 / Math.max(0.8, pose.z);
  const cx = 50 + pose.x * 22 * s;
  const ground = 88;
  const h = 46 * s * (1 - 0.25 * pose.crouch);
  const hip = ground - h * 0.5;
  const sh = ground - h * 0.95;
  const foot = (pose.stanceWidth / 2) * 22 * s;
  const lean = pose.lean * 30 * s;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="defender-canvas" data-testid="defender-2d" aria-label="Defender (2D fallback)">
      <rect x="0" y="0" width="100" height="100" fill="#1b2430" />
      <rect x="0" y="60" width="100" height="40" fill="#2f6b3a" />
      {[-1.5, -0.9, 0.9, 1.5].map((x) => (
        <polygon key={x} points={`${50 + x * 22},${93} ${50 + x * 22 - 1.5},${97} ${50 + x * 22 + 1.5},${97}`} fill="#d9822b" />
      ))}
      <ellipse cx={cx} cy={ground + 1} rx={10 * s} ry={1.5 * s} fill="#000" opacity="0.35" />
      <g stroke="#3a4f7a" strokeWidth={4 * s} strokeLinecap="round" fill="none">
        <line x1={cx - foot} y1={ground} x2={cx + lean * 0.3 - 3 * s} y2={hip} stroke="#2b3550" />
        <line x1={cx + foot} y1={ground} x2={cx + lean * 0.3 + 3 * s} y2={hip} stroke="#2b3550" />
        <line x1={cx + lean * 0.3} y1={hip} x2={cx + lean} y2={sh} strokeWidth={7 * s} />
        <line x1={cx + lean - 5 * s} y1={sh + 2 * s} x2={cx + lean - 5 * s - 6 * s * pose.armSpread} y2={sh + 12 * s} />
        <line x1={cx + lean + 5 * s} y1={sh + 2 * s} x2={cx + lean + 5 * s + 6 * s * pose.armSpread} y2={sh + 12 * s} />
      </g>
      <circle cx={cx + lean} cy={sh - 5 * s} r={3.2 * s} fill="#c8a07e" />
    </svg>
  );
}
