import { useRef, useState } from 'react';
import type { DefenderScenario } from '../db/types';
import { Defender2D, Defender3D } from './DefenderView';
import { poseAt, type DefenderMotion } from './stateMachine';

export const motionOf = (s: DefenderScenario): DefenderMotion => ({
  approachMs: s.approachMs,
  approachAngleDeg: s.approachAngleDeg,
  initialSide: s.initialSide,
  reaction: s.reaction,
  commitDirection: s.commitDirection,
  strength: s.strength,
  reactionDelayMs: s.reactionDelayMs,
  recovery: s.recovery,
});

const REACTION_TEXT: Record<DefenderScenario['reaction'], string> = {
  commit: 'stepped across',
  hold: 'held its position',
  delay: 'waited, then stepped across',
  commitOpposite: 'stepped across early',
  commitThenRecover: 'stepped across, then recovered in front',
};

/** Top-down explanation after the rep (never during the decision window): where the defender went and the open side. */
export function TopDown({ s }: { s: DefenderScenario }) {
  const dir = s.commitDirection === 'left' ? -1 : s.commitDirection === 'right' ? 1 : 0;
  const finalX = s.recovery || s.reaction === 'hold' ? 0 : dir * 0.7;
  const open = s.correctExit;
  return (
    <div className="stack">
      <svg viewBox="-2 -0.5 4 4.5" style={{ width: '100%', maxWidth: 320, background: '#2f6b3a', borderRadius: 8 }} aria-label="Top-down view of the rep">
        {[-1.5, -0.9, 0.9, 1.5].map((x) => (
          <circle key={x} cx={x} cy={0.6} r={0.07} fill="#d9822b" />
        ))}
        <circle cx={0} cy={3.6} r={0.16} fill="#fff" />
        <text x={0} y={4.15} fontSize={0.25} textAnchor="middle" fill="#fff">
          player
        </text>
        {dir !== 0 ? <line x1={0} y1={1.6} x2={dir * 0.7} y2={1.6} stroke="#ffd23f" strokeWidth={0.05} strokeDasharray="0.1 0.06" /> : null}
        <circle cx={finalX} cy={1.6} r={0.2} fill="#3a4f7a" stroke="#fff" strokeWidth={0.03} />
        {open !== 'protect' ? (
          <path d={`M 0 3.3 Q ${open === 'left' ? -1.2 : 1.2} 2.4 ${open === 'left' ? -1.2 : 1.2} 0.8`} stroke="#3ddc84" strokeWidth={0.07} fill="none" />
        ) : (
          <rect x={-0.3} y={2.8} width={0.6} height={0.25} fill="#3ddc84" rx={0.05} />
        )}
      </svg>
      <p>
        The defender {REACTION_TEXT[s.reaction]}
        {s.commitDirection && s.reaction !== 'hold' ? ` to your ${s.commitDirection}` : ''}. Right action:{' '}
        {open === 'protect' ? 'second move or protect the ball' : `exit ${open}`}. ({s.archetype} defender; reaction drawn with game-design odds, not a model of a real defender.)
      </p>
    </div>
  );
}

/** The recorded rep beside the defender's movement for that rep, kept in step with the video (task 2.5). */
export function DefenderReplay({ scenario, clipUrl, startActiveMs, onClose }: { scenario: DefenderScenario; clipUrl: string; startActiveMs: number; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  const [use2d, setUse2d] = useState(scenario.view === 'fallback2d');
  const repStart = scenario.cueEvents.find((e) => e.state === 'repStart')?.atMs ?? 0;
  const trigger = scenario.cueEvents.find((e) => e.state === 'trigger')?.atMs ?? repStart;
  const m = motionOf(scenario);
  const getPose = () => {
    const t = (video.current?.currentTime ?? 0) * 1000 + startActiveMs - repStart;
    return poseAt(m, Math.max(0, t), trigger - repStart);
  };
  return (
    <div className="stack">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>Rep {scenario.repIndex + 1} replay</h3>
        <button className="btn small" onClick={onClose}>
          Close replay
        </button>
      </div>
      <div className="grid2">
        <video
          ref={video}
          src={clipUrl}
          controls
          playsInline
          style={{ width: '100%', background: '#000', borderRadius: 12 }}
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = Math.max(0, (repStart - startActiveMs) / 1000);
            e.currentTarget.playbackRate = 0.5;
          }}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime * 1000 + startActiveMs > repStart + m.approachMs + 4000) {
              e.currentTarget.pause();
              setEnded(true);
            }
          }}
        />
        <div style={{ position: 'relative', aspectRatio: '16 / 9' }}>{use2d ? <Defender2D getPose={getPose} /> : <Defender3D getPose={getPose} onFallback={() => setUse2d(true)} />}</div>
      </div>
      {ended ? <TopDown s={scenario} /> : <p className="muted">The explanation appears when the rep has played.</p>}
    </div>
  );
}
