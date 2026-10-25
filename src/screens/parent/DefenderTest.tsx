import { useRef, useState } from 'react';
import { useData } from '../../app/data';
import { db } from '../../db/db';
import type { DefenderReaction, Side } from '../../db/types';
import { ARCHETYPE_TABLE, type ArchetypeId } from '../../defender/engine';
import { Defender3D } from '../../defender/DefenderView';
import { TopDown } from '../../defender/Replay';
import { mocapPose } from '../../defender/mocap';
import { plannedTriggerMs, poseAt, repEndMs, type DefenderMotion } from '../../defender/stateMachine';
import { useMocap } from '../../defender/useMocap';
import { Seg } from '../../ui/widgets';

const CASES: { label: string; reaction: DefenderReaction; dir?: Side }[] = [
  { label: 'Commit left', reaction: 'commit', dir: 'left' },
  { label: 'Commit right', reaction: 'commit', dir: 'right' },
  { label: 'Hold', reaction: 'hold' },
  { label: 'Late reaction', reaction: 'delay', dir: 'right' },
  { label: 'Commit then recover', reaction: 'commitThenRecover', dir: 'left' },
];

/** Parent → 3D defender test: measures the frame rate on this Chromebook (task 2.1) and shows each reaction for the visual check (part 16 §12 "3D"). */
export function DefenderTestSection() {
  const { settings } = useData();
  const [i, setI] = useState(0);
  const [angle, setAngle] = useState(10);
  const [fps, setFps] = useState<number[]>([]);
  const [fell, setFell] = useState('');
  // Freeze at a moment of the rep (seconds), for a close look; empty = play on a loop.
  const [freeze, setFreeze] = useState<number | null>(null);
  const started = useRef(performance.now());
  const [recorded, setRecorded] = useState(!!settings.flags.realisticDefender);
  const lib = useMocap(recorded);
  const c = CASES[i];
  const m: DefenderMotion = { approachMs: 1800, approachAngleDeg: angle, initialSide: 'centre', reaction: c.reaction, commitDirection: c.dir, strength: 0.8, reactionDelayMs: 250, recovery: c.reaction === 'commitThenRecover' };
  const trig = plannedTriggerMs(m);
  // Recorded recoveries take longer than the generated ones: let them finish before the loop restarts.
  const loop = repEndMs(m, trig) + (recorded ? 2200 : 600);
  const getPose = () => {
    const t = freeze !== null ? freeze * 1000 : (performance.now() - started.current) % loop;
    const pose = poseAt(m, t, trig);
    return lib ? mocapPose(lib, m, t, trig, pose) : pose;
  };
  const best = fps.length ? Math.min(...fps.slice(-5)) : undefined;
  async function saveFps() {
    if (best === undefined) return;
    await db.settings.update('main', { capabilities: { ...(settings.capabilities ?? { checkedAt: new Date().toISOString(), webgl: true, webgl2: false }), defenderFps: best, defenderFpsAt: new Date().toISOString() } });
  }
  return (
    <div className="stack">
      <div className="card stack">
        <p>
          Each reaction plays on a loop. Check from the far end that commits left and right, the hold, the late reaction and the recovery are clearly different, and that nothing on the screen
          points to the right exit. The frame rate is measured while it runs.
        </p>
        <Seg value={i} onChange={(v) => ((started.current = performance.now()), setI(v))} options={CASES.map((x, k) => ({ value: k, label: x.label }))} />
        <Seg value={recorded ? 'recorded' : 'generated'} onChange={(v) => ((started.current = performance.now()), setRecorded(v === 'recorded'))} options={[{ value: 'generated', label: 'Generated movement' }, { value: 'recorded', label: 'Recorded movement (experimental)' }]} />
        <Seg value={angle} onChange={setAngle} options={[-20, 0, 10, 25].map((a) => ({ value: a, label: `approach ${a}°` }))} />
        <label className="row">
          <input type="checkbox" checked={freeze !== null} onChange={(e) => setFreeze(e.target.checked ? 2.2 : null)} aria-label="Freeze at a moment" />
          <span>Freeze at</span>
          <input
            type="range"
            min={0}
            max={(loop / 1000).toFixed(1)}
            step={0.05}
            value={freeze ?? 0}
            disabled={freeze === null}
            onChange={(e) => setFreeze(Number(e.target.value))}
            aria-label="Moment in the rep (s)"
            style={{ flex: 1 }}
          />
          <span className="mono">{freeze !== null ? `${freeze.toFixed(2)} s · ${poseAt(m, freeze * 1000, trig).state}` : 'playing'}</span>
        </label>
      </div>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', maxHeight: '60vh', margin: '0 auto', width: '100%' }}>
        {fell ? <div className="error-box">{fell}</div> : <Defender3D key={`${i}-${angle}`} getPose={getPose} onFps={(f) => setFps((x) => [...x.slice(-9), f])} onFallback={(why) => setFell(`Fallback: ${why}. Reactive drills will use the 2D view or word/arrow cues on this device.`)} />}
      </div>
      <div className="card row spread">
        <span>
          Measured: {fps.length ? `${fps[fps.length - 1]} fps now, lowest recent ${best} fps` : 'measuring…'} · saved: {settings.capabilities?.defenderFps ? `${settings.capabilities.defenderFps} fps` : 'none'}
        </span>
        <button className="btn primary" disabled={best === undefined} onClick={saveFps}>
          Save this measurement
        </button>
      </div>
      <div className="card stack">
        <h3>Archetypes (game-design parameters, not real-defender models)</h3>
        <table className="data">
          <thead>
            <tr>
              <th>Defender</th>
              <th>commit</th>
              <th>hold</th>
              <th>late</th>
              <th>commit opposite</th>
              <th>commit then recover</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(ARCHETYPE_TABLE) as ArchetypeId[]).map((a) => (
              <tr key={a}>
                <td>{a}</td>
                {(['commit', 'hold', 'delay', 'commitOpposite', 'commitThenRecover'] as DefenderReaction[]).map((r) => (
                  <td key={r}>{Math.round(ARCHETYPE_TABLE[a][r] * 100)}%</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Before quality, pattern and difficulty adjustments. A strong feint raises the chance of a commitment but never above 85%.</p>
      </div>
      <div className="card">
        <h3>After-rep explanation (shown only after the rep)</h3>
        <TopDown s={{ id: 'demo', repIndex: 0, view: 'player3d', archetype: 'reactive', difficulty: 2, reactionSeed: 0, approachAngleDeg: angle, approachSpeed: 1, approachMs: 1800, initialSide: 'centre', reaction: c.reaction, commitDirection: c.dir, strength: 0.8, reactionDelayMs: 250, recovery: m.recovery, cueEvents: [], triggerSource: 'plannedTiming', rendererVersion: '', correctExit: c.reaction === 'hold' || m.recovery ? 'protect' : c.dir === 'left' ? 'right' : 'left', parametersVersion: 'gd-1' }} />
      </div>
    </div>
  );
}
