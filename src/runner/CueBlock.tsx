import { useEffect, useRef, useState, type ReactNode } from 'react';
import { say, tone } from '../audio/audio';
import { CueDisplay } from '../cue/CueDisplay';
import { initCue, tickCue, type CueConfig, type CueInput, type CueLogEntry, type CueState } from '../cue/engine';

/** Practice view of a cue block: the whole screen is the cue (plan/02 §2.6). */
export function CueBlock(props: {
  config: CueConfig;
  activeMs: () => number;
  paused: boolean;
  onLog: (log: CueLogEntry[]) => void;
  onRepsDone: () => void;
  input?: () => CueInput;
  header: ReactNode;
  controls: ReactNode;
}) {
  const { config, activeMs, paused, onLog, onRepsDone, input, header, controls } = props;
  const state = useRef<CueState>(initCue(config));
  const [, force] = useState(0);
  const finished = useRef(false);
  const cb = useRef({ activeMs, onLog, onRepsDone, input });
  cb.current = { activeMs, onLog, onRepsDone, input };

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      const { activeMs, onLog, onRepsDone, input } = cb.current;
      const r = tickCue(state.current, activeMs(), input?.() ?? {});
      const changed = r.state !== state.current;
      state.current = r.state;
      for (const a of r.actions) {
        if (a.type === 'repTone') tone('start');
        else if (a.type === 'cueTone') tone('cue');
        else say(a.text);
      }
      if (changed) {
        onLog(r.state.log);
        force((n) => n + 1);
      }
      if (r.state.done && !finished.current) {
        finished.current = true;
        onRepsDone();
      }
    }, 20);
    return () => clearInterval(t);
  }, [paused]);

  const s = state.current;
  const reps = s.config.reps;
  const waiting = s.repStartMs === null ? 'Get ready' : s.config.useTripwire ? 'Go' : '';
  return (
    <div className={`practice cue ${paused ? 'paused' : ''}`}>
      <CueDisplay view={paused ? null : s.view} waiting={paused ? 'PAUSED' : waiting} />
      <div className="overlay-top">
        {header}
        <span>{reps ? `rep ${Math.min(reps, s.repIdx + 1)} of ${reps}` : s.repIdx >= 0 ? `rep ${s.repIdx + 1}` : ''}</span>
      </div>
      <div className="controls">{controls}</div>
    </div>
  );
}
