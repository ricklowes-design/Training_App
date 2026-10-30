import { useState } from 'react';
import { useData } from '../app/data';
import { useNav } from '../app/nav';
import type { ContentSession } from '../content/types';
import { areaCountsFor, areaName, buildPlan, findSession } from '../domain/plans';
import { Seg } from '../ui/widgets';
import { useAreaProgress } from './helpers';

/** Session builder (plan/02 §2.4): duration → areas → solo/partner → intensity. Always the next unlocked session per area. */
export function Builder() {
  const { programme: p, settings } = useData();
  const { go } = useNav();
  const progress = useAreaProgress();
  const [minutes, setMinutes] = useState(30);
  const [areas, setAreas] = useState<string[]>([]);
  const [partner, setPartner] = useState(settings.partnerAvailable);
  const [light, setLight] = useState(false);

  const counts = areaCountsFor(p, minutes);
  const maxAreas = Math.max(0, ...counts);
  const ready = progress.filter((pr) => pr.placed && pr.next !== null && !pr.awaitingAdvancement);
  const sessions = areas.map((a) => {
    const pr = progress.find((x) => x.areaId === a);
    return pr?.next ? findSession(p, a, pr.next) : undefined;
  });
  const valid = sessions.every((s): s is ContentSession => !!s);
  const result = valid && areas.length ? buildPlan(p, { minutes, sessions: sessions as ContentSession[], light, partner }) : null;

  const toggle = (a: string) => {
    if (areas.includes(a)) setAreas(areas.filter((x) => x !== a));
    else if (areas.length < maxAreas) setAreas([...areas, a]);
  };

  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ margin: 0 }}>Build a session</h1>
        <button className="btn" onClick={() => go({ name: 'home' })}>
          Back
        </button>
      </div>
      <div className="card stack">
        <div className="row">
          <span className="muted" style={{ minWidth: 120 }}>
            Duration
          </span>
          <Seg
            value={minutes}
            onChange={(m) => {
              setMinutes(m);
              setAreas((x) => x.slice(0, Math.max(0, ...areaCountsFor(p, m))));
            }}
            options={p.builder.durations.map((d) => ({ value: d, label: `${d} min` }))}
          />
        </div>
        <div className="row">
          <span className="muted" style={{ minWidth: 120 }}>
            Areas (up to {maxAreas})
          </span>
          {ready.map((pr) => (
            <button key={pr.areaId} className={`btn ${areas.includes(pr.areaId) ? 'primary' : ''}`} onClick={() => toggle(pr.areaId)}>
              {areaName(p, pr.areaId)} S{pr.next}
            </button>
          ))}
        </div>
        <div className="row">
          <span className="muted" style={{ minWidth: 120 }}>
            With
          </span>
          <Seg value={partner ? 'partner' : 'solo'} onChange={(v) => setPartner(v === 'partner')} options={[{ value: 'solo', label: 'Solo' }, { value: 'partner', label: 'Partner' }]} />
        </div>
        <div className="row">
          <span className="muted" style={{ minWidth: 120 }}>
            Intensity
          </span>
          <Seg value={light ? 'light' : 'normal'} onChange={(v) => setLight(v === 'light')} options={[{ value: 'normal', label: 'Normal' }, { value: 'light', label: 'Light (no benchmark, longer rest)' }]} />
        </div>
        <p className="muted">The builder always uses the next unlocked session in each area; it never lets you pick ahead.</p>
      </div>
      {result && !result.ok ? <div className="error-box" style={{ marginTop: 16 }}>{result.reason} Available for {minutes} min: {counts.join(' or ') || 'none'} area(s).</div> : null}
      {result?.ok ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>{result.plan.title}</h2>
          <table className="data">
            <tbody>
              {result.plan.blocks.map((b, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    {b.kind === 'work'
                      ? `${areaName(p, b.areaId ?? '')} · ${b.drillId} ${p.drills.find((d) => d.id === b.drillId)?.name ?? ''}${b.params ? ` (${b.params})` : ''}`
                      : b.kind === 'benchmark'
                        ? `${areaName(p, b.areaId ?? '')} benchmark ${b.benchmarkId}`
                        : b.kind}
                  </td>
                  <td className="mono">{b.minutes} min</td>
                </tr>
              ))}
              <tr>
                <td />
                <td>
                  <strong>Total training</strong>
                </td>
                <td className="mono">
                  <strong>{result.plan.totalMinutes} min + setup</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn go xl" onClick={() => go({ name: 'start', plan: result.plan })}>
              Continue
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
