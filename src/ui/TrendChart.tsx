import { useState } from 'react';
import type { BenchmarkResult } from '../db/types';
import { segments, type Trend, type TrendPanel } from '../domain/trend';
import { fmtDate } from './widgets';

// Benchmark trend chart (plan/05 §5.6): one small panel per measure, sharing the date axis, so a
// time and its errors are never on two scales of one chart. Right and left feet are drawn together
// in fixed colours (right first), missing weeks are gaps, unreliable results are never drawn.

const W = 640;
const PAD = { l: 44, r: 40, t: 12, b: 22 };
const DAY = 86_400_000;

const colour = (side: string | undefined, i: number) => (side === 'left' || (!side && i === 1) ? 'var(--series-2)' : 'var(--series-1)');
const tag = (label: string, side?: string) => (side === 'right' ? 'R' : side === 'left' ? 'L' : label);
const n1 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

function domain(p: TrendPanel): [number, number] {
  const vals = p.series.flatMap((s) => s.points.map((x) => x.value));
  if (p.max !== undefined) return [0, p.max];
  if (p.id === 'errors') return [0, Math.max(3, ...vals)];
  if (p.id === 'time') {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(0.5, (hi - lo) * 0.2);
    return [Math.max(0, Math.floor(lo - pad)), Math.ceil(hi + pad)];
  }
  return [0, Math.max(5, Math.ceil(Math.max(...vals) * 1.15))];
}

function ticks([lo, hi]: [number, number]): number[] {
  const step = [1, 2, 5, 10, 20].find((s) => (hi - lo) / s <= 4) ?? Math.ceil((hi - lo) / 4);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

export function TrendChart({ trend, highlight, testId }: { trend: Trend; highlight?: { start: Date; end: Date }; testId?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const pts = trend.included;
  const t0 = new Date(pts[0].date).getTime();
  const t1 = Math.max(new Date(pts[pts.length - 1].date).getTime(), highlight ? Math.min(highlight.end.getTime(), Date.now()) : 0);
  const span = Math.max(t1 - t0, 7 * DAY);
  const x = (iso: string) => PAD.l + ((new Date(iso).getTime() - t0) / span) * (W - PAD.l - PAD.r);
  const multi = trend.panels.some((p) => p.series.length > 1);
  const activeR = pts.find((r) => r.id === active);
  const dateTicks = Array.from({ length: 4 }, (_, i) => new Date(t0 + (span * i) / 3).toISOString());
  const panels = trend.panels;

  return (
    <div className="trend" data-testid={testId}>
      {multi ? (
        <div className="trend-legend">
          {panels
            .flatMap((p) => p.series)
            .filter((s, i, all) => all.findIndex((y) => y.label === s.label) === i)
            .map((s, i) => (
              <span key={s.key}>
                <i style={{ background: colour(s.side, i) }} /> {s.label}
              </span>
            ))}
        </div>
      ) : null}
      {panels.map((p, pi) => {
        const H = p.id === 'errors' || p.id === 'digits' ? 96 : 150;
        const [lo, hi] = domain(p);
        const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
        const last = pi === panels.length - 1;
        return (
          <div key={p.id} className="trend-panel">
            <div className="trend-title">
              {p.title}
              {p.unit && p.unit !== 's' && p.unit !== 'errors' ? ` (${p.unit})` : p.unit === 's' ? ' (s, lower is quicker)' : ''}
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.title} trend`} onPointerLeave={() => setActive(null)}>
              {highlight ? (
                <rect
                  x={Math.max(PAD.l, x(highlight.start.toISOString()))}
                  width={Math.max(0, Math.min(W - PAD.r, x(new Date(Math.min(highlight.end.getTime(), t1)).toISOString())) - Math.max(PAD.l, x(highlight.start.toISOString())))}
                  y={PAD.t}
                  height={H - PAD.t - PAD.b}
                  className="trend-band"
                />
              ) : null}
              {ticks([lo, hi]).map((v) => (
                <g key={v}>
                  <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="trend-grid" />
                  <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="trend-axis">
                    {v}
                  </text>
                </g>
              ))}
              {last
                ? dateTicks.map((d, i) => (
                    <text key={d} x={x(d)} y={H - 4} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'} className="trend-axis">
                      {fmtDate(d)}
                    </text>
                  ))
                : null}
              {activeR ? <line x1={x(activeR.date)} x2={x(activeR.date)} y1={PAD.t} y2={H - PAD.b} className="trend-cross" /> : null}
              {p.series.map((s, si) => (
                <g key={s.key} stroke={colour(s.side, si)} fill={colour(s.side, si)}>
                  {segments(s.points).map((seg, k) =>
                    seg.length > 1 ? <polyline key={k} fill="none" strokeWidth={2} strokeLinejoin="round" points={seg.map((q) => `${x(q.date)},${y(q.value)}`).join(' ')} /> : null,
                  )}
                  {s.points.map((q) => (
                    <circle key={q.resultId} cx={x(q.date)} cy={y(q.value)} r={q.resultId === active ? 6 : 4} stroke="var(--panel)" strokeWidth={2} />
                  ))}
                  {p.series.length > 1 && s.points.length ? (
                    <text x={x(s.points[s.points.length - 1].date) + 9} y={y(s.points[s.points.length - 1].value) + 4} className="trend-direct" stroke="none">
                      {tag(s.label, s.side)}
                    </text>
                  ) : null}
                </g>
              ))}
              {pts.map((r, i) => {
                const left = i === 0 ? PAD.l : (x(pts[i - 1].date) + x(r.date)) / 2;
                const right = i === pts.length - 1 ? W - PAD.r : (x(r.date) + x(pts[i + 1].date)) / 2;
                return <rect key={r.id} x={left} width={Math.max(1, right - left)} y={0} height={H} fill="transparent" onPointerEnter={() => setActive(r.id)} onPointerDown={() => setActive(r.id)} />;
              })}
            </svg>
          </div>
        );
      })}
      {activeR ? <Tooltip r={activeR} trend={trend} /> : <div className="trend-tip muted">Tap or point at a result to see its numbers.</div>}
      <TrendNotes trend={trend} />
      <details onToggle={(e) => setShowTable((e.target as HTMLDetailsElement).open)}>
        <summary>Table</summary>
        {showTable ? <TrendTable trend={trend} /> : null}
      </details>
    </div>
  );
}

/** All of one result's numbers, a time always with its errors. */
function Tooltip({ r, trend }: { r: BenchmarkResult; trend: Trend }) {
  const parts = trend.panels.flatMap((p) =>
    p.series.flatMap((s) => {
      const q = s.points.find((x) => x.resultId === r.id);
      if (!q || p.id === 'errors' || p.id === 'digits') return [];
      const errs = trend.panels.find((x) => x.id === 'errors')?.series.find((x) => x.key === s.key)?.points.find((x) => x.resultId === r.id);
      return [`${s.label} ${n1(q.value)}${p.id === 'time' ? ` s · ${errs?.value ?? 0} err` : p.id === 'vpulls' ? ' in 30 s' : p.max ? `/${p.max}` : ''}`];
    }),
  );
  return (
    <div className="trend-tip" data-testid="trend-tip">
      <strong>{fmtDate(r.date, { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
      {r.attempt > 1 ? ` (attempt ${r.attempt})` : ''}: {parts.join(' · ')}
    </div>
  );
}

function TrendNotes({ trend }: { trend: Trend }) {
  const c = trend.reference.conditions;
  const by = [...new Set(trend.included.map((r) => r.conditions.recordedBy))].join(', ');
  const reasons = [...new Set(trend.excluded.map((e) => e.reason))];
  return (
    <div className="muted trend-notes">
      <div>
        {c.layoutVersion === 0 ? 'Anchor layout' : `Layout v${c.layoutVersion}`} · cue level {c.cueLevel}
        {c.roomProfileVersion ? ` · room ${c.roomProfileVersion}` : ''}
        {c.taskMode ? ` · ${c.taskMode}` : ''} · recorded by {by} · {trend.included.length} result{trend.included.length > 1 ? 's' : ''} at these conditions
      </div>
      {trend.unreliable.length ? (
        <div>
          Unreliable (not drawn): {trend.unreliable.map((r) => `${fmtDate(r.date)} (${r.flagged})`).join(' · ')}
        </div>
      ) : null}
      {trend.excluded.length ? (
        <div>
          Not joined: {trend.excluded.length} earlier result{trend.excluded.length > 1 ? 's' : ''} at other conditions ({reasons.join('; ')})
        </div>
      ) : null}
    </div>
  );
}

function TrendTable({ trend }: { trend: Trend }) {
  const cols = trend.panels.flatMap((p) => p.series.map((s) => ({ p, s })));
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Date</th>
          {cols.map(({ p, s }) => (
            <th key={`${p.id}-${s.key}`}>
              {p.title} {p.series.length > 1 || p.title !== s.label ? tag(s.label, s.side) : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trend.included.map((r) => (
          <tr key={r.id}>
            <td className="mono">{fmtDate(r.date, { day: 'numeric', month: 'short', year: '2-digit' })}</td>
            {cols.map(({ p, s }) => (
              <td key={`${p.id}-${s.key}`}>{n1(s.points.find((q) => q.resultId === r.id)?.value ?? NaN).replace('NaN', '—')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
