import { useMemo, useState } from 'react';
import { TurnOnNeeded } from '../runner/TurnOnNeeded';
import { unlockAudio } from '../audio/audio';
import { useData } from '../app/data';
import { useNav } from '../app/nav';
import type { RunPlan } from '../domain/plans';
import { runRoute, trialFor, planRoomFit } from './helpers';

/** Block list with minutes and total, the trial toggle, and one Start tap. */
export function StartScreen({ plan }: { plan: RunPlan }) {
  const d = useData();
  const { programme: p } = d;
  const { go } = useNav();
  const sugg = useMemo(() => trialFor(d, plan), [d, plan]);
  const [trial, setTrial] = useState(sugg.suggested);
  const isTrial = sugg.forced || trial;
  const name = (b: RunPlan['blocks'][number]) =>
    b.kind === 'work'
      ? `${b.drillId} ${p.drills.find((x) => x.id === b.drillId)?.name ?? ''}${b.params ? ` (${b.params})` : ''}`
      : b.kind === 'benchmark'
        ? `Benchmark ${b.benchmarkId} (level ${b.cueLevel})`
        : b.kind === 'anchor'
          ? `${b.anchorId} ${p.anchors.find((a) => a.id === b.anchorId)?.name ?? ''}`
          : b.kind;
  const kind = plan.parts[0]?.kind;
  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ margin: 0 }}>{plan.title}</h1>
        <button className="btn" onClick={() => go({ name: 'home' })}>
          Back
        </button>
      </div>
      <div className="card">
        <table className="data">
          <tbody>
            {plan.blocks.map((b, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td style={{ textTransform: b.kind === 'work' || b.kind === 'benchmark' || b.kind === 'anchor' ? 'none' : 'capitalize' }}>{name(b)}</td>
                <td className="mono">
                  {b.minutes} min{b.slotMinutes ? <span className="muted"> · compared only with other {b.slotMinutes}-minute tests</span> : null}
                </td>
              </tr>
            ))}
            <tr>
              <td />
              <td>
                <strong>Total training</strong>
              </td>
              <td className="mono">
                <strong>{plan.totalMinutes} min + setup</strong>
              </td>
            </tr>
          </tbody>
        </table>
        {/* Planned training time, not a promised finish (Brief R08). */}
        <p className="muted" data-testid="time-note">Training time only: cone set-up, instructions and the end-of-drill cards add a few minutes.</p>
        {planRoomFit(d, plan) ? <p className="pill warn">{planRoomFit(d, plan)}</p> : null}
        <TurnOnNeeded blocks={plan.blocks} what="This session" />
        {kind === 'extra' || kind === 'anchor' ? <p className="muted">This is an extra: it does not unlock a session or count toward the week.</p> : null}
      </div>
      <div className="row spread" style={{ marginTop: 16 }}>
        <label className="check">
          <input type="checkbox" checked={isTrial} disabled={sugg.forced} onChange={(e) => setTrial(e.target.checked)} />
          Trial {sugg.reasons.length ? <span className="muted">({sugg.reasons.join(' ')})</span> : null}
        </label>
        {/* Full screen needs a tap; Chrome does not allow it on its own (audit task 17). */}
        {document.fullscreenEnabled && !document.fullscreenElement ? (
          <button className="btn" onClick={() => void document.documentElement.requestFullscreen().catch(() => undefined)}>
            Full screen
          </button>
        ) : null}
        <button
          className="btn go huge"
          disabled={!!planRoomFit(d, plan)}
          onClick={() => {
            unlockAudio();
            go(runRoute(d, plan, isTrial));
          }}
        >
          Start
        </button>
      </div>
    </div>
  );
}
