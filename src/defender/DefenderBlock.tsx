import { useEffect, useRef, useState, type ReactNode } from 'react';
import { tone } from '../audio/audio';
import type { DefenderScenario } from '../db/types';
import { initDefenderBlock, tickDefenderBlock, type DefenderBlockConfig, type DefenderBlockState, type DefenderInput } from './block';
import { Defender2D, Defender3D } from './DefenderView';
import { mocapPose } from './mocap';
import { poseAt, type DefenderPose } from './stateMachine';
import { useMocap } from './useMocap';

const IDLE: DefenderPose = { state: 'approach', x: 0, z: 6, yaw: 0, crouch: 0.15, stanceWidth: 0.3, lean: 0, hipShift: 0, stepPhase: 0, stepAmp: 0, armSpread: 0.2, weightSide: 0 };

/** Practice view of a defender block (task 2.4): the whole screen is the defender, seen from the player. */
export function DefenderBlock(props: {
  config: DefenderBlockConfig;
  activeMs: () => number;
  paused: boolean;
  onLog: (scenarios: DefenderScenario[], view: DefenderBlockConfig['view'], fallbackReason?: string) => void;
  onRepsDone: () => void;
  /** Live trigger source (camera onset); given the active ms from which an onset can count. */
  input?: (repStartMs: number) => DefenderInput;
  header: ReactNode;
  controls: ReactNode;
  onFps?: (fps: number) => void;
}) {
  const { config, activeMs, paused, onLog, onRepsDone, input, header, controls, onFps } = props;
  const [view, setView] = useState(config.view);
  const [fallbackReason, setFallbackReason] = useState<string | undefined>(config.view === 'fallback2d' ? 'WebGL not available or 3D turned off' : undefined);
  const state = useRef<DefenderBlockState>(initDefenderBlock(config));
  const lib = useMocap(config.motion === 'recorded');
  const [, force] = useState(0);
  const finished = useRef(false);
  const tap = useRef<number | undefined>(undefined);
  const cb = useRef({ activeMs, onLog, onRepsDone, input, view, fallbackReason });
  cb.current = { activeMs, onLog, onRepsDone, input, view, fallbackReason };

  useEffect(() => {
    if (paused) {
      tap.current = undefined; // a tap made while paused is not a feint
      return;
    }
    const t = setInterval(() => {
      const { activeMs, onLog, onRepsDone, input } = cb.current;
      const st = state.current;
      const rep = st.plan[st.repIdx % st.plan.length];
      // Movement while the defender is still approaching is not the feint.
      const live = input && st.repStartMs !== null && rep ? input(st.repStartMs + rep.approachMs * 0.6) : {};
      const r = tickDefenderBlock(state.current, activeMs(), { ...live, triggerAtMs: tap.current ?? live.triggerAtMs });
      const changed = r.state !== state.current;
      if (r.state.repIdx !== state.current.repIdx) tap.current = undefined;
      state.current = r.state;
      for (const a of r.actions) if (a.type === 'repTone') tone('start');
      if (changed) {
        // The view actually used is what gets recorded.
        const scen = r.state.scenarios.map((x) => ({ ...x, view: cb.current.view }));
        onLog(scen, cb.current.view, cb.current.fallbackReason);
        force((n) => n + 1);
      }
      if (r.state.done && !finished.current) {
        finished.current = true;
        onRepsDone();
      }
    }, 20);
    return () => clearInterval(t);
  }, [paused]);

  const getPose = (): DefenderPose => {
    const s = state.current;
    const rep = s.plan[s.repIdx % s.plan.length];
    if (s.repStartMs === null || !rep) return IDLE;
    const rel = cb.current.activeMs() - s.repStartMs;
    const m = s.motion ?? { approachMs: rep.approachMs, approachAngleDeg: rep.approachAngleDeg, initialSide: rep.initialSide, reaction: 'hold' as const, strength: 0, reactionDelayMs: 0, recovery: false };
    const trig = s.motion ? s.triggerRel : null;
    const pose = poseAt(m, rel, trig);
    return lib ? mocapPose(lib, m, rel, trig, pose) : pose;
  };

  const s = state.current;
  const reps = s.config.reps;
  const parentTrigger = config.trigger === 'parentTrigger';
  return (
    <div
      className={`practice defender ${paused ? 'paused' : ''}`}
      onPointerDown={parentTrigger ? () => (tap.current = cb.current.activeMs()) : undefined}
    >
      {view === 'player3d' ? (
        // The canvas stays through PAUSE; PAUSED is drawn on top (audit task 12).
        <Defender3D getPose={getPose} onFps={onFps} paused={paused} onFallback={(why) => (setFallbackReason(why), setView('fallback2d'))} />
      ) : paused ? null : (
        <Defender2D getPose={getPose} />
      )}
      {paused ? <div className="cue-screen paused-overlay">PAUSED</div> : null}
      <div className="overlay-top">
        {header}
        <span>
          {reps ? `rep ${Math.max(1, Math.min(reps, s.repIdx + 1))} of ${reps}` : ''}
          {view === 'fallback2d' ? ' · 2D fallback' : ''}
          {parentTrigger ? ' · parent taps when the feint starts' : ''}
        </span>
      </div>
      {/* PAUSE, STOP and DONE never count as the parent's feint tap. */}
      <div className="controls" onPointerDown={(e) => e.stopPropagation()}>
        {controls}
      </div>
    </div>
  );
}
