import { useLiveQuery } from 'dexie-react-hooks';
import { capstoneGates } from '../domain/capstone';
import { useState } from 'react';
import { db } from '../db/db';
import { monthReview, reviewText } from '../domain/review';
import { trendFor } from '../domain/trend';
import { TrendChart } from '../ui/TrendChart';
import { useData } from '../app/data';
import { useNav } from '../app/nav';
import { resultText } from '../domain/metrics';
import { areaName, findSession, repeatPlan } from '../domain/plans';
import { countedResults, countsForWeek, isRecorded } from '../domain/records';
import { addDays, weekStart } from '../domain/sequencing';
import { tryFill } from '../domain/templates';
import { downloadText, fmtDate, statusText } from '../ui/widgets';
import { ruleStatusFor, useAreaProgress } from './helpers';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WeekTab() {
  const d = useData();
  const { programme: p, records, settings, results } = d;
  const [offset, setOffset] = useState(0);
  const ws = addDays(weekStart(new Date(), settings.weekStartDay), offset * 7);
  const we = addDays(ws, 7);
  const inWeek = (iso: string) => new Date(iso) >= ws && new Date(iso) < we;
  const weekRecs = records.filter((r) => inWeek(r.date));
  const done = weekRecs.filter(countsForWeek);
  const runMinutes = new Map<string, number>();
  for (const r of done) runMinutes.set(r.runId, (runMinutes.get(r.runId) ?? 0) + r.plannedMinutes);
  const minutes = Math.round([...runMinutes.values()].reduce((a, b) => a + b, 0));
  const extras = weekRecs.filter((r) => (r.kind === 'extra' || r.kind === 'anchor') && isRecorded(r));
  const notCounted = weekRecs.filter((r) => r.kind === 'programme' && isRecorded(r) && !countsForWeek(r));
  const trials = weekRecs.filter((r) => r.trial && !r.promotedAt);
  const counted = countedResults(results, records);
  const anchorsInWeek = counted.filter((r) => /^A\d$/.test(r.benchmarkId) && inWeek(r.date));

  // Last 8 weeks of completed sessions.
  const bars = Array.from({ length: 8 }, (_, i) => {
    const s = addDays(ws, -7 * (7 - i));
    const e = addDays(s, 7);
    return records.filter((r) => countsForWeek(r) && new Date(r.date) >= s && new Date(r.date) < e).length;
  });
  const max = Math.max(settings.weeklyTarget, ...bars, 1);

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Week of {fmtDate(ws.toISOString(), { day: 'numeric', month: 'short', year: 'numeric' })}</h2>
          <div className="row">
            <button className="btn small" onClick={() => setOffset(offset - 1)}>
              ◀
            </button>
            <button className="btn small" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>
              ▶
            </button>
          </div>
        </div>
        {done.length === 0 ? (
          <p>{tryFill(p.feedbackTemplates, 'noSessionsThisWeek', {})}</p>
        ) : (
          <>
            <p>
              Planned {settings.weeklyTarget} · Completed {done.length} · Minutes {minutes}
            </p>
            <ul className="clean">
              {p.areas.map((a) => {
                const mine = weekRecs.filter((r) => r.areaId === a.id && r.kind === 'programme' && isRecorded(r));
                return (
                  <li key={a.id} className="row spread">
                    <span>{areaName(p, a.id)}</span>
                    <span>
                      {mine.length
                        ? mine.map((r) => `S${r.sessionNumber} ${countsForWeek(r) ? '✔' : '○'} ${DAY[new Date(r.date).getDay()]}${countsForWeek(r) ? (r.status === 'completedBenchmarkSkipped' ? ' (benchmark skipped)' : '') : ` (${statusText(r.status)})`}`).join(', ')
                        : '— not done this week'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {notCounted.length ? <p className="muted">Not counted: {notCounted.map((r) => `${areaName(p, r.areaId ?? '')} S${r.sessionNumber} ${statusText(r.status)}`).join(' · ')}</p> : null}
        {extras.length ? (
          <p className="muted">
            Extras:{' '}
            {extras
              .map((r) => {
                const q = results.find((x) => x.sessionRecordId === r.id && x.benchmarkId === 'QUIZ');
                const label = r.kind === 'anchor' ? 'anchor check' : q ? 'picture quiz' : `repeat ${areaName(p, r.areaId ?? '')} S${r.sessionNumber}`;
                return `${label} ${DAY[new Date(r.date).getDay()]}${q ? ` (${resultText(q.values).replace('Picture quiz ', '')})` : ''}`;
              })
              .join(' · ')}
          </p>
        ) : null}
        {anchorsInWeek.length ? <p className="muted">Anchors: {anchorsInWeek.map((r) => `${r.benchmarkId} ${resultText(r.values)}`).join(' · ')}</p> : null}
        {trials.length ? <p className="muted">Trials this week: {trials.length} (not counted; see Parent → Trials)</p> : null}
      </div>
      {offset === 0 && done.length === 0 ? <PrevWeek ws={addDays(ws, -7)} /> : null}
      {done.length === 0 ? null : (
      <div className="card">
        <h3>Last 8 weeks (completed sessions)</h3>
        <div className="bars">
          {bars.map((n, i) => (
            <div className="b" key={i}>
              <span>{n}</span>
              <div style={{ height: `${(100 * n) / max}px` }} />
              <span>W{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

function PrevWeek({ ws }: { ws: Date }) {
  const { records, programme: p } = useData();
  const we = addDays(ws, 7);
  const done = records.filter((r) => countsForWeek(r) && new Date(r.date) >= ws && new Date(r.date) < we);
  return (
    <div className="card tight muted">
      Previous week ({fmtDate(ws.toISOString())}): {done.length ? done.map((r) => `${areaName(p, r.areaId ?? '')} S${r.sessionNumber}`).join(', ') : 'none'}
    </div>
  );
}

function SkillsTab() {
  const d = useData();
  const { programme: p, notes, settings } = d;
  const { go } = useNav();
  const progress = useAreaProgress();
  return (
    <div className="stack">
      {progress.map((pr) => {
        const a = p.areas.find((x) => x.id === pr.areaId)!;
        const stage = p.stages.find((s) => s.id === pr.stageId);
        const status = ruleStatusFor(d, pr.areaId);
        const done = [...pr.completed].sort((x, y) => x - y);
        const note = notes.filter((n) => !n.resolvedAt && ((n.target.kind === 'area' && n.target.id === a.id) || (n.target.kind === 'drill' && p.drills.find((x) => x.id === n.target.id)?.areaId === a.id))).sort((x, y) => y.date.localeCompare(x.date))[0];
        const isPriority = a.priorityTags.some((t) => settings.priorities.includes(t));
        return (
          <div key={a.id} className="card stack">
            <div className="row spread">
              <h2 style={{ margin: 0 }}>
                {a.name.toUpperCase()} {isPriority ? <span className="pill info">priority</span> : null}
              </h2>
              <span>{pr.placed ? `Stage ${stage?.order} · ${stage?.name} · Session ${pr.next ?? pr.totalSessions} of ${pr.totalSessions}` : 'Baseline not done'}</span>
            </div>
            {pr.placed ? (
              <>
                <div>
                  Completed: {done.length ? done.map((n) => `S${n}`).join(' ') : '—'} · Next: {pr.next ? `S${pr.next}` : 'all done'}
                  {pr.next && pr.next < pr.totalSessions ? ` · Locked: S${pr.next + 1}–S${pr.totalSessions}` : ''}
                  {pr.start > 1 ? <span className="muted"> · placed at S{pr.start}</span> : null}
                </div>
                {pr.awaitingAdvancement ? <div className="pill warn">Stage {stage?.order} awaiting criteria and parent confirmation</div> : null}
                {status ? (
                  <div>
                    To reach {status.rule.to === 'exit' ? 'the end of the area' : `Stage ${p.stages.find((s) => s.id === status.rule.to)?.order}`}: {status.criteriaText}
                    {status.needed ? ` — ${status.qualifying} of ${status.needed}` : ''}
                    {status.latest ? ` (${fmtDate(status.latest.date)}: ${resultText(status.latest.values)})` : ''}
                    {status.rule.requiresTransfer ? ` · coach transfer note ${status.hasTransfer ? 'recorded' : 'needed'}` : ''}
                    {status.met ? <span className="pill go"> criteria met: awaiting parent confirmation</span> : null}
                    {status.withheld ? <span className="pill warn"> withheld: {status.withheld.reason}</span> : null}
                  </div>
                ) : null}
                {note ? (
                  <div className="note-box">
                    Coach note {fmtDate(note.date)}: “{note.body}”
                  </div>
                ) : null}
                {done.length ? (
                  <div className="row">
                    <span className="muted">Repeat a completed session (extra):</span>
                    {done.map((n) => (
                      <button key={n} className="btn small" onClick={() => go({ name: 'start', plan: repeatPlan(p, findSession(p, a.id, n)!) })}>
                        S{n}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="muted">Each area starts with its baseline (10–12 minutes). It is the next suggestion on the home screen.</div>
            )}
          </div>
        );
      })}
      <CapstoneCard />
    </div>
  );
}

/** The linked challenge (task 5.5): shown with its gate, locked until every component is validated. */
function CapstoneCard() {
  const { programme: p, settings } = useData();
  const { open, gates } = capstoneGates(p, settings);
  return (
    <div className="card stack">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{p.capstone.name}</h2>
        <span className={`pill ${open ? 'go' : ''}`}>{open ? 'available' : 'locked'}</span>
      </div>
      <div>{p.capstone.chain.join(' → ')}</div>
      <p className="muted">{p.capstone.note}</p>
      <ul className="clean">
        {gates.map((g) => (
          <li key={g.id}>
            {g.passed ? '✔' : '○'} {g.label}: {g.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DrillsTab() {
  const { programme: p, results, records } = useData();
  const { go } = useNav();
  const counted = countedResults(results, records);
  const tests = [...p.benchmarks.filter((b) => b.id !== 'CA'), ...p.anchors.map((a) => ({ id: a.id, name: `Anchor ${a.id} · ${a.name}` }))];
  const caDrills = [...new Set(counted.filter((r) => r.benchmarkId === 'CA').map((r) => r.drillId))];
  const drilled = new Set(records.filter(isRecorded).flatMap((r) => r.blocks.map((b) => b.drillId)));
  return (
    <div className="stack">
      <div className="card">
        <h3>Tests and benchmarks</h3>
        <ul className="clean">
          {tests.map((t) => {
            const n = counted.filter((r) => r.benchmarkId === t.id).length;
            return (
              <li key={t.id} className="row spread">
                <span>
                  {t.id} · {t.name}
                </span>
                <button className="btn small" disabled={!n} onClick={() => go({ name: 'drill', key: `bench:${t.id}` })}>
                  {n ? `${n} result${n > 1 ? 's' : ''}` : 'no results yet'}
                </button>
              </li>
            );
          })}
          {caDrills.map((dr) => (
            <li key={`CA-${dr}`} className="row spread">
              <span>Cue accuracy · {dr}</span>
              <button className="btn small" onClick={() => go({ name: 'drill', key: `bench:CA:${dr}` })}>
                Open
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3>Drills</h3>
        <ul className="clean">
          {p.drills.map((dr) => (
            <li key={dr.id} className="row spread">
              <span>
                {dr.id} · {dr.name} <span className="muted">({areaName(p, dr.areaId)})</span>
              </span>
              <button className="btn small" disabled={!drilled.has(dr.id)} onClick={() => go({ name: 'drill', key: `drill:${dr.id}` })}>
                {drilled.has(dr.id) ? 'History' : 'not done yet'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The monthly review (plan/05 §5.6): the month in numbers, then one chart per test done in it. */
function ReviewTab() {
  const d = useData();
  const { programme: p, results, records } = d;
  const [offset, setOffset] = useState(0);
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const m = monthReview({ ...d, weeklyTarget: d.settings.weeklyTarget }, first.getFullYear(), first.getMonth(), today);
  const kept = useLiveQuery(() => db.clips.where('date').between(m.start.toISOString(), m.end.toISOString()).filter((c) => !!c.keep).count(), [m.start.getTime()]) ?? 0;
  const counted = countedResults(results, records).filter((r) => new Date(r.date) < m.end);
  const name = (id: string) => p.benchmarks.find((b) => b.id === id)?.name ?? (p.anchors.find((a) => a.id === id) ? `Anchor ${id} · ${p.anchors.find((a) => a.id === id)!.name}` : id);
  const text = reviewText(m, kept);
  const rows: [string, string][] = [
    ['Consistency', text.split('\n')[1].replace('Consistency: ', '')],
    ['Areas', m.areas.length ? m.areas.map((a) => `${a.name} ${a.sessions}`).join(' · ') : '—'],
    ['Benchmarks', m.benchmarks.length ? m.benchmarks.join(' · ') : '—'],
    ['Left/right', m.leftRight.length ? m.leftRight.join(' · ') : '—'],
    ['Advanced', m.advanced.length ? m.advanced.join(' · ') : '—'],
    ['Coach feedback', m.coach.length ? m.coach.join(' → ') : '—'],
    ['Clips marked for review', String(kept)],
  ];
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>{m.title}</h2>
          <div className="row">
            <button className="btn small" aria-label="Previous month" onClick={() => setOffset(offset - 1)}>
              ◀
            </button>
            <button className="btn small" aria-label="Next month" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>
              ▶
            </button>
          </div>
        </div>
        <table className="data" data-testid="month-review">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button className="btn small" onClick={() => downloadText(`review-${m.start.getFullYear()}-${String(m.start.getMonth() + 1).padStart(2, '0')}.txt`, text + '\n', 'text/plain')}>
            Export summary (text)
          </button>
          <span className="muted">Saved to this Chromebook; nothing is sent anywhere. Kept clips can be downloaded one by one from Parent → Clips.</span>
        </div>
      </div>
      {m.charted.map((t) => {
        const tr = trendFor(counted, t.benchmarkId, t.drillId);
        if (!tr) return null;
        return (
          <div key={`${t.benchmarkId}:${t.drillId ?? ''}`} className="card stack">
            <h3 style={{ margin: 0 }}>
              {t.benchmarkId} · {name(t.benchmarkId)}
              {t.drillId ? ` · ${t.drillId}` : ''}
            </h3>
            <TrendChart trend={tr} highlight={{ start: m.start, end: m.end }} testId={`trend-${t.benchmarkId}${t.drillId ? `-${t.drillId}` : ''}`} />
          </div>
        );
      })}
      {m.charted.length ? null : <p className="muted">No tests or anchors this month; their charts appear here once there is a result.</p>}
    </div>
  );
}

export function Progress({ tab }: { tab: 'week' | 'skills' | 'drills' | 'review' }) {
  const { go } = useNav();
  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ margin: 0 }}>Progress</h1>
        <button className="btn" onClick={() => go({ name: 'home' })}>
          Home
        </button>
      </div>
      <div className="tabs">
        {(['week', 'skills', 'drills', 'review'] as const).map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} onClick={() => go({ name: 'progress', tab: t })}>
            {t === 'week' ? 'Week' : t === 'skills' ? 'Skills' : t === 'drills' ? 'Drills' : 'Review'}
          </button>
        ))}
      </div>
      {tab === 'week' ? <WeekTab /> : tab === 'skills' ? <SkillsTab /> : tab === 'drills' ? <DrillsTab /> : <ReviewTab />}
    </div>
  );
}
