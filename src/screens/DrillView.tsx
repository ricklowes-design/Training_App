import { personalBests } from '../domain/personalBest';
import { useState } from 'react';
import { useData } from '../app/data';
import { useNav } from '../app/nav';
import type { BenchmarkResult } from '../db/types';
import { comparability, pickComparison, type ComparePick } from '../domain/comparability';
import { comparisonSentences, resultLines } from '../domain/metrics';
import { countedResults, isRecorded } from '../domain/records';
import { tryFill } from '../domain/templates';
import { trendFor } from '../domain/trend';
import { TrendChart } from '../ui/TrendChart';
import { fmtClock, fmtDate, Seg } from '../ui/widgets';

const condText = (r: BenchmarkResult) => `${r.conditions.layoutVersion === 0 ? 'anchor layout' : `layout v${r.conditions.layoutVersion}`} · level ${r.conditions.cueLevel}`;
const line = (r: BenchmarkResult) =>
  resultLines(r.values)
    .map((l) => `${l.label} ${l.text}`)
    .join(' · ');

function BenchmarkHistory({ id, drillId }: { id: string; drillId?: string }) {
  const { programme: p, results, records } = useData();
  const all = countedResults(results, records)
    .filter((r) => r.benchmarkId === id && (drillId === undefined || r.drillId === drillId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.attempt - a.attempt);
  const [pickKind, setPickKind] = useState<'last' | 'm1' | 'm3' | 'date'>('last');
  const [date, setDate] = useState('');
  const t = p.feedbackTemplates;
  const now = all[0];
  const name = p.benchmarks.find((b) => b.id === id)?.name ?? p.anchors.find((a) => a.id === id)?.name ?? id;
  // An empty history says what to do next (Brief R15).
  if (!now) return <p data-testid="no-results">{tryFill(t, 'noResultsYet', { test: name }) ?? 'No results yet.'}</p>;

  const pick: ComparePick = pickKind === 'last' ? { kind: 'last' } : pickKind === 'm1' ? { kind: 'monthsAgo', months: 1 } : pickKind === 'm3' ? { kind: 'monthsAgo', months: 3 } : { kind: 'date', date: date || now.date };
  const then = pickKind === 'date' && !date ? undefined : pickComparison(now, all, pick);
  // When the picked date's nearest result is at other conditions, say why it is not compared.
  let refusal: string | null = null;
  if (!then && pickKind === 'date' && date) {
    const nearest = all.filter((r) => r.id !== now.id && r.date.slice(0, 10) <= date)[0];
    const c = nearest ? comparability(now, nearest) : null;
    refusal = c && !c.ok ? (tryFill(t, 'comparisonRefused', { reason: c.reason }) ?? c.reason) : 'No result on or before that date.';
  } else if (!then) {
    const other = all.find((r) => r.id !== now.id && !comparability(now, r).ok);
    const c = other ? comparability(now, other) : null;
    refusal = c && !c.ok ? (tryFill(t, 'comparisonRefused', { reason: c.reason }) ?? c.reason) : 'No earlier result at the same conditions.';
  }

  const pbs = personalBests(now, all);
  const trend = trendFor(all, id, drillId);
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>{name}</h2>
          <div className="row">
            <span className="muted">Compare:</span>
            <Seg
              value={pickKind}
              onChange={setPickKind}
              options={[
                { value: 'last', label: 'last session' },
                { value: 'm1', label: '1 month ago' },
                { value: 'm3', label: '3 months ago' },
                { value: 'date', label: 'pick a date' },
              ]}
            />
            {pickKind === 'date' ? <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 180 }} /> : null}
          </div>
        </div>
        <p style={{ fontSize: '1.3rem' }}>
          <strong>Now ({fmtDate(now.date)}):</strong> {line(now)} <span className="muted">· {condText(now)}</span>
        </p>
        {then ? (
          <>
            <p style={{ fontSize: '1.3rem' }}>
              <strong>Then ({fmtDate(then.date)}):</strong> {line(then)}
            </p>
            {comparisonSentences(t, name, now.values, then.values, true).map((s, i) => (
              <p key={i} className="muted">
                {s}
              </p>
            ))}
          </>
        ) : (
          <p className="muted">{refusal}</p>
        )}
        {pbs.length ? (
          <div data-testid="personal-best">
            <strong>Best recorded result at these conditions:</strong>{' '}
            {pbs.map((b, i) => (
              <span key={b.key}>
                {i ? ' · ' : ''}
                {b.label} {b.text} ({b.isNow ? 'this result' : fmtDate(b.date)})
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {trend && trend.included.length > 1 ? (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Trend (same conditions only)</h3>
          <TrendChart trend={trend} testId="trend-chart" />
        </div>
      ) : null}
      <div className="card">
        <h3>History (same conditions; others greyed with the reason)</h3>
        <table className="data">
          <tbody>
            {all.map((r) => {
              const c = comparability(now, r);
              return (
                <tr key={r.id} className={c.ok ? '' : 'greyed'}>
                  <td className="mono">{fmtDate(r.date, { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                  <td>{line(r)}</td>
                  <td className="muted">
                    {condText(r)}
                    {r.attempt > 1 ? ` · attempt ${r.attempt}` : ''}
                    {c.ok ? '' : ` · not compared: ${c.reason}`}
                    {r.flagged ? ` · unreliable: ${r.flagged}` : ''} · {r.conditions.recordedBy}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PracticeHistory({ drillId }: { drillId: string }) {
  const { programme: p, records } = useData();
  const drill = p.drills.find((d) => d.id === drillId);
  const rows = records
    .filter(isRecorded)
    .flatMap((r) => r.blocks.filter((b) => b.drillId === drillId).map((b) => ({ r, b })))
    .sort((x, y) => y.r.date.localeCompare(x.r.date));
  return (
    <div className="card stack">
      <h2>
        {drillId} · {drill?.name}
      </h2>
      <p className="muted">Practice blocks are counted, not compared. Benchmarks and anchors carry the numbers.</p>
      <table className="data">
        <tbody>
          {rows.map(({ r, b }, i) => (
            <tr key={i}>
              <td className="mono">{fmtDate(r.date, { day: 'numeric', month: 'short', year: '2-digit' })}</td>
              <td>{b.skipped ? 'skipped' : `${fmtClock(b.elapsedS)} of ${fmtClock(b.plannedS)}`}{b.attempt > 1 ? ` · attempt ${b.attempt}` : ''}</td>
              <td className="muted">
                {r.areaId} S{r.sessionNumber ?? '—'} {b.note ? `· “${b.note}”` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DrillView({ drillKey }: { drillKey: string }) {
  const { go } = useNav();
  const [kind, a, b] = drillKey.split(':');
  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ margin: 0 }}>Drill view</h1>
        <button className="btn" onClick={() => go({ name: 'progress', tab: 'drills' })}>
          Back
        </button>
      </div>
      {kind === 'bench' ? <BenchmarkHistory id={a} drillId={b} /> : <PracticeHistory drillId={a} />}
    </div>
  );
}
