import { dayKind } from '../domain/sequencing';
import { useMemo, useState } from 'react';
import { unlockAudio } from '../audio/audio';
import { useData } from '../app/data';
import { useNav } from '../app/nav';
import { db } from '../db/db';
import { useRoomProfile } from '../app/room';
import { areaName, buildPlan, digitDiagnosticPlan, findSession, noBallPlan, type RunPlan } from '../domain/plans';
import { lastCredibleImprovement, todayGoals } from '../domain/focus';
import { tryFill } from '../domain/templates';
import { reasonsFor } from '../domain/recommend';
import { useLiveQuery } from 'dexie-react-hooks';
import { countsForWeek } from '../domain/records';
import { nextForArea, weekStart, type Suggestion } from '../domain/sequencing';
import { fmtDate, Seg } from '../ui/widgets';
import { anchorDue, anchorRun, backupDue, planForSuggestion, planRoomFit, runRoute, trialFor, useAreaProgress, useSuggestion } from './helpers';

function describe(p: ReturnType<typeof useData>['programme'], s: Suggestion): { title: string; detail: string; minutes: number } {
  if (s.kind === 'baseline') {
    const bl = p.baselines.find((b) => b.areaId === s.areaId);
    return { title: `${areaName(p, s.areaId)} · Baseline`, detail: 'Benchmark and two placement drills; a parent answers three questions after.', minutes: bl?.blocks.reduce((t, b) => t + b.minutes, 0) ?? 0 };
  }
  const sess = findSession(p, s.areaId, s.sessionNumber);
  const stage = p.stages.find((x) => x.id === sess?.stageId);
  const drills = (sess?.blocks ?? [])
    .map((b) => (b.type === 'work' ? p.drills.find((d) => d.id === b.drillId)?.name ?? b.drillId : b.type === 'benchmark' ? `${b.benchmarkId} benchmark` : null))
    .filter((x, i, arr): x is string => !!x && arr.indexOf(x) === i);
  const prefix = s.kind === 'repeatForCriteria' ? 'Repeat (stage criteria pending) · ' : '';
  return {
    title: `${prefix}${areaName(p, s.areaId)} · Stage ${stage?.order} · Session ${s.sessionNumber}`,
    detail: drills.join(' + '),
    minutes: sess?.durationMinutes ?? 20,
  };
}

function StartCard({ plan, title, detail, minutes, big, label }: { plan: RunPlan; title: string; detail: string; minutes: number; big?: boolean; label?: string }) {
  const d = useData();
  const { go } = useNav();
  const sugg = useMemo(() => trialFor(d, plan), [d, plan]);
  const [trial, setTrial] = useState<boolean | null>(null);
  const isTrial = sugg.forced || (trial ?? sugg.suggested);
  const unfit = planRoomFit(d, plan);
  return (
    <div className="card row spread" style={{ alignItems: 'stretch' }}>
      <div className="col" style={{ flex: 1, gap: 6 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <div>{detail}</div>
        <div className="muted">{minutes} min · solo{d.settings.partnerAvailable ? ' or partner' : ''}</div>
        {unfit ? <div className="pill warn">{unfit}</div> : null}
        <label className="check" style={{ fontSize: '0.95rem' }}>
          <input type="checkbox" checked={isTrial} disabled={sugg.forced} onChange={(e) => setTrial(e.target.checked)} />
          Trial {sugg.reasons.length ? <span className="muted">({sugg.reasons.join(' ')})</span> : <span className="muted">(nothing counts until kept)</span>}
        </label>
      </div>
      <button
        className={`btn go ${big ? 'huge' : 'xl'}`}
        disabled={!!unfit}
        onClick={() => {
          unlockAudio();
          go(runRoute(d, plan, isTrial));
        }}
      >
        {label ?? 'Start'}
      </button>
    </div>
  );
}

const DURATIONS = [20, 30, 45, 60] as const;

/** The guided session for a chosen length (D14): the suggested session at 20 min, the builder templates for longer. */
function guidedPlan(d: ReturnType<typeof useData>, main: Suggestion | null, others: Suggestion[], minutes: number, light: boolean): { plan: RunPlan | null; reason?: string } {
  if (!main) return { plan: null };
  if (minutes === 20 && !light) return { plan: planForSuggestion(d, main) };
  if (main.kind !== 'session') return { plan: null, reason: main.kind === 'baseline' ? 'The baseline runs as a 20-minute session.' : 'While stage criteria are pending, the 20-minute repeat is suggested.' };
  const p = d.programme;
  const want = minutes === 45 ? 2 : minutes === 60 ? 3 : 1;
  const sessions = [main, ...others.filter((s) => s.kind === 'session')]
    .slice(0, want)
    .map((s) => findSession(p, s.areaId, (s as { sessionNumber: number }).sessionNumber))
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (sessions.length < want) return { plan: null, reason: `${minutes} minutes needs ${want} areas with a next session.` };
  const r = buildPlan(p, { minutes, sessions, light, partner: d.settings.partnerAvailable });
  return r.ok ? { plan: r.plan } : { plan: null, reason: r.reason };
}

export function Home() {
  const d = useData();
  const { programme: p, settings, player, records, milestones } = d;
  const { go } = useNav();
  const progress = useAreaProgress();
  const suggestion = useSuggestion();
  const [minutes, setMinutes] = useState<number>(20);
  // Remembered for this browser session only (a per-viewer convenience).
  const [focusOpen, setFocusOpenState] = useState(() => {
    try {
      return sessionStorage.getItem('home-focus-open') === '1';
    } catch {
      return false;
    }
  });
  const setFocusOpen = (v: boolean) => {
    setFocusOpenState(v);
    try {
      sessionStorage.setItem('home-focus-open', v ? '1' : '0');
    } catch {
      // storage blocked: the panel just won't be remembered
    }
  };
  const ws = weekStart(new Date(), settings.weekStartDay);
  const weekDone = records.filter((r) => countsForWeek(r) && new Date(r.date) >= ws);
  const anchor = anchorDue(d);
  const pending = milestones.filter((m) => !m.shownAt).sort((a, b) => a.date.localeCompare(b.date));
  const others = progress
    .map((pr) => nextForArea(p, pr))
    .filter((s): s is Suggestion => !!s && !(suggestion && s.areaId === suggestion.areaId));
  const kindToday = dayKind(settings, new Date());
  const lightDay = kindToday !== 'normal';
  const [light, setLight] = useState<boolean | null>(null);
  const isLight = light ?? lightDay;
  const guided = useMemo(() => guidedPlan(d, suggestion, others, minutes, isLight), [d, suggestion, others, minutes, isLight]); // eslint-disable-line react-hooks/exhaustive-deps
  const mainPlan = guided.plan;
  const goals = suggestion ? todayGoals(p, (mainPlan ?? planForSuggestion(d, suggestion))?.blocks.map((b) => b.drillId).filter((x): x is string => !!x) ?? [], suggestion.areaId, settings.priorities) : [];
  const observations = useLiveQuery(() => db.metricObservations.toArray(), []);
  const why = useMemo(
    () =>
      suggestion
        ? reasonsFor({ programme: p, placements: d.placements, records, results: d.results, advancements: d.advancements, transfers: d.transfers, extraCriteria: d.extraCriteria, observations: observations ?? [], now: new Date(), allocation: settings.allocation, weekStart: ws }, suggestion.areaId)
        : [],
    [p, d, records, observations, suggestion],
  );
  const improvement = useMemo(() => lastCredibleImprovement(p, d.results, records), [p, d.results, records]);

  if (pending.length && settings.milestoneCards) {
    const m = pending[0];
    return (
      <div className="endcard">
        <div className="title">Milestone</div>
        <div className="now">{m.text}</div>
        <div className="actions">
          <span />
          <button className="btn go" onClick={() => db.milestones.update(m.id, { shownAt: new Date().toISOString() })}>
            OK
          </button>
        </div>
      </div>
    );
  }

  const sessionTitle = suggestion ? describe(p, suggestion) : null;
  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ margin: 0 }}>
          {player?.name ?? 'Player'} · Week of {fmtDate(ws.toISOString())}
        </h1>
        <div className="row">
          <span className="muted">
            {weekDone.length} of {settings.weeklyTarget} planned done
          </span>
          <button className="btn" onClick={() => go({ name: 'progress', tab: 'week' })}>
            Progress
          </button>
          <button className="btn" aria-label="Parent mode" onClick={() => go({ name: 'parent', section: 'hub' })}>
            ⚙ Parent
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16 }} className="stack">
        <RoomChoice />
        {!settings.ballCheck ? (
          <div className="card tight row spread" data-testid="ball-check-prompt">
            <span>
              <strong>Before the first drills (parent, 3 minutes):</strong> show the webcam each ball you have, and the app picks the one it can follow best.
            </span>
            <span className="row">
              <button className="btn small primary" onClick={() => go({ name: 'parent', section: 'balls' })}>
                Ball check
              </button>
              <button className="btn small" onClick={() => db.settings.update('main', { ballCheck: { date: new Date().toISOString(), skipped: true, results: [] } })}>
                Not now
              </button>
            </span>
          </div>
        ) : null}
        {suggestion && sessionTitle ? (
          <>
            <div className="row" style={{ fontSize: '1.2rem' }}>
              <span className="muted">Session length</span>
              <Seg value={minutes} onChange={setMinutes} options={DURATIONS.map((m) => ({ value: m, label: `${m} min` }))} />
              {lightDay || light ? (
                <label className="check">
                  <input type="checkbox" checked={isLight} onChange={(e) => setLight(e.target.checked)} />
                  Light
                </label>
              ) : null}
            </div>
            {lightDay ? <div className="muted">{tryFill(p.feedbackTemplates, kindToday === 'game' ? 'gameDay' : kindToday === 'rest' ? 'restDay' : 'lightDay', {})}</div> : null}
            {mainPlan ? (
              <StartCard
                key={`main-${suggestion.areaId}-${minutes}-${isLight}`}
                plan={mainPlan}
                title={minutes === 20 && !isLight ? sessionTitle.title : mainPlan.title}
                detail={minutes === 20 && !isLight ? sessionTitle.detail : mainPlan.blocks.filter((b) => b.drillId).map((b) => b.drillId).join(' + ')}
                minutes={mainPlan.totalMinutes}
                label="Start my session"
                big
              />
            ) : (
              <div className="card">{guided.reason ?? 'No session available at this length.'}</div>
            )}
            {goals.length ? <div style={{ fontSize: '1.3rem' }}>{tryFill(p.feedbackTemplates, 'homeToday', { goals: goals.join(' · ') })}</div> : null}
            <div className="muted">{improvement ?? tryFill(p.feedbackTemplates, 'homeNoImprovement', {})}</div>
            {why.length ? <div className="muted">{tryFill(p.feedbackTemplates, 'recommendWhy', { reasons: why.join('; ') })}</div> : null}
          </>
        ) : (
          <div className="card">Every session in every area is done. Repeat sessions or ask the coach for the next step.</div>
        )}

        <div className="row">
          <button className="btn" aria-expanded={focusOpen} onClick={() => setFocusOpen(!focusOpen)}>
            Choose a focus {focusOpen ? '▾' : '▸'}
          </button>
          <button className="btn" onClick={() => go({ name: 'progress', tab: 'skills' })}>
            Repeat a completed session
          </button>
        </div>

        {focusOpen ? (
          <div className="stack" data-testid="focus-panel">
            <div className="card tight row">
              <span className="muted">This week:</span>
              {p.areas.map((a) => {
                const done = weekDone.filter((r) => r.areaId === a.id);
                const pr = progress.find((x) => x.areaId === a.id);
                return (
                  <span key={a.id}>
                    {done.length ? '✔' : '○'} {areaName(p, a.id)}
                    {pr?.placed && pr.next ? ` S${pr.next}` : ''}
                  </span>
                );
              })}
            </div>
            {others.length ? (
              <div className="card stack">
                <div className="muted">Other unlocked</div>
                {others.map((s) => {
                  const plan = planForSuggestion(d, s);
                  return plan ? <StartCard key={s.areaId} plan={plan} {...describe(p, s)} /> : null;
                })}
                <div className="muted lock">Locked: everything after those (complete the one before it).</div>
              </div>
            ) : null}
            <div className="row">
              <button className="btn" onClick={() => go({ name: 'builder' })}>
                Build a longer session
              </button>
              <button className="btn" onClick={() => go({ name: 'start', plan: noBallPlan(p) })}>
                No-ball picture quiz
              </button>
              <button className="btn" onClick={() => go({ name: 'start', plan: anchorRun(d) })}>
                Anchor check{anchor.due ? ' · due' : ''}
              </button>
              {digitDiagnosticPlan(p) ? (
                <button className="btn" onClick={() => go({ name: 'start', plan: digitDiagnosticPlan(p)! })}>
                  Scanning diagnostic (optional)
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {backupDue(d) ? <p className="muted">A backup is due. A parent can make one in Parent → Backup.</p> : null}
      </div>
    </div>
  );
}

/** Training in another room: each room keeps its own measurements, so its drills are set out to fit it. */
function RoomChoice() {
  const { programme, settings, roomProfiles, roomProfile, layout } = useData();
  const rooms = roomProfiles.filter((r) => !r.retiredAt);
  if (rooms.length < 2) return null;
  return (
    <label className="row muted" data-testid="room-choice">
      <span>Training in</span>
      <select value={roomProfile?.id ?? ''} aria-label="Training room" onChange={(e) => useRoomProfile(e.target.value, programme, settings)}>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <span>· drills are set out to fit this room{layout ? ` (layout v${layout.version})` : ''}</span>
    </label>
  );
}

