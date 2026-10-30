import { useEffect, useRef, useState } from 'react';
import { say, setSoundSettings } from '../audio/audio';
import { APP_VERSION, logHistory, useData, type AppData } from '../app/data';
import { useNav } from '../app/nav';
import { db } from '../db/db';
import type { SessionRecord } from '../db/types';
import { plateau } from '../domain/advancement';
import { lastComparable } from '../domain/comparability';
import { isCompletedStatus } from '../domain/completion';
import { comparisonSentences } from '../domain/metrics';
import { recordMilestones } from '../domain/milestoneStore';
import { areaName } from '../domain/plans';
import { countedResults, countsForWeek } from '../domain/records';
import { areaProgress } from '../domain/sequencing';
import { promote } from '../domain/trial';
import { tryFill } from '../domain/templates';
import { StatusPill } from '../ui/widgets';
import { ruleStatusFor } from './helpers';
import { useLiveQuery } from 'dexie-react-hooks';
import { Scorecard } from '../analysis/Scorecard';

/** Camera scorecards for the run's analysed blocks (they may arrive a few minutes after the session). */
function RunScorecards({ recordIds }: { recordIds: string[] }) {
  const rows = useLiveQuery(async () => {
    const clips = await db.clips.where('sessionRecordId').anyOf(recordIds).toArray();
    const out = [];
    for (const c of clips.sort((a, b) => a.blockIndex - b.blockIndex || a.attempt - b.attempt)) {
      const a = await db.blockAnalyses.get(c.id);
      const reps = a ? (await db.repAnalyses.where('clipId').equals(c.id).sortBy('repIndex')).map((r) => r.data) : [];
      out.push({ c, a: a?.data, reps });
    }
    return out;
  }, [recordIds.join(',')]);
  if (!rows?.length) return null;
  return (
    <div className="stack">
      {rows.map(({ c, a, reps }) => (
        <div key={c.id}>
          <h3>
            Block {c.blockIndex + 1} · {c.blockLabel}
            {c.attempt > 1 ? ` · attempt ${c.attempt}` : ''}
          </h3>
          {a ? <Scorecard analysis={a} reps={reps} /> : <p className="muted">Recorded{c.drillId ? '' : ''}. {reps.length ? '' : 'Analysis pending or not applicable (only cue blocks are analysed).'}</p>}
        </div>
      ))}
    </div>
  );
}

/** One achievement, one comparison, one focus, one unlock (plan/02 §2.8). All from templates. */
export function summaryLines(d: AppData, rec: SessionRecord): string[] {
  const p = d.programme;
  const t = p.feedbackTemplates;
  const lines: (string | null)[] = [];
  const area = rec.areaId ? areaName(p, rec.areaId) : '';
  const countedNow = isCompletedStatus(rec.status) && (!rec.trial || !!rec.promotedAt);

  if (rec.kind === 'extra') lines.push(tryFill(t, 'extraSaved', { title: rec.sessionNumber ? `${area} Session ${rec.sessionNumber}` : 'The session' }));
  if (rec.kind === 'anchor') lines.push(tryFill(t, 'anchorSaved', {}));
  if (rec.trial && !rec.promotedAt) lines.push(tryFill(t, 'trialSaved', {}));

  const blocks = rec.blocks.filter((b) => b.attempt === 1 && ['warmup', 'work', 'benchmark', 'anchor', 'quiz'].includes(b.kind)).length;
  const prog = rec.areaId ? areaProgress(p, rec.areaId, d.placements.find((x) => x.areaId === rec.areaId), d.records, d.advancements) : null;

  if (rec.status === 'stopped') {
    lines.push(tryFill(t, 'stopped', {}));
    return lines.filter((x): x is string => !!x);
  }
  if (rec.kind === 'programme') {
    if (rec.status === 'completed') {
      // Return after a gap of a week or more.
      const prev = d.records.filter((r) => r.id !== rec.id && countsForWeek(r) && r.date < rec.date).sort((a, b) => b.date.localeCompare(a.date))[0];
      // Calendar days between the two sessions (local dates), not 24-hour periods.
      const day = (iso: string) => {
        const d = new Date(iso);
        return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
      };
      const gapDays = prev ? Math.round((day(rec.date) - day(prev.date)) / 86_400_000) : 0;
      if (countedNow && gapDays >= 7 && prog?.next) lines.push(tryFill(t, 'return', { days: gapDays, next: prog.next }));
      else lines.push(tryFill(t, 'completed', { area, n: rec.sessionNumber ?? '', blocks, minutes: Math.round(rec.plannedMinutes) }));
      lines.push(tryFill(t, 'allBlocksCompleted', {}));
    } else if (rec.status === 'completedBenchmarkSkipped') {
      lines.push(tryFill(t, 'completedBenchmarkSkipped', { next: prog?.next ?? (rec.sessionNumber ?? 0) + 1 }));
    } else if (rec.status === 'partial') {
      lines.push(tryFill(t, 'partial', { n: rec.sessionNumber ?? '' }));
      lines.push(tryFill(t, 'reason', { reason: rec.reasons.join(', ') }));
    }
  } else if (rec.kind === 'baseline') {
    const bl = p.baselines.find((b) => b.areaId === rec.areaId);
    lines.push(tryFill(t, 'baselineSaved', { count: bl?.questions.length ?? 3, area }));
  } else if (rec.status === 'partial') {
    lines.push(tryFill(t, 'reason', { reason: rec.reasons.join(', ') }));
  }

  // One comparison: the first benchmark result in this session against the last at the same conditions.
  const counted = countedResults(d.results, d.records);
  const mine = d.results.filter((r) => r.sessionRecordId === rec.id).sort((a, b) => a.blockIndex - b.blockIndex || a.attempt - b.attempt);
  const first = mine.find((r) => r.benchmarkId !== 'QUIZ') ?? mine[0];
  if (first) {
    const prev = lastComparable(first, counted.filter((r) => r.sessionRecordId !== rec.id));
    const name = p.benchmarks.find((b) => b.id === first.benchmarkId)?.name ?? p.anchors.find((a) => a.id === first.benchmarkId)?.name ?? first.benchmarkId;
    lines.push(comparisonSentences(t, name, first.values, prev?.values, !!prev)[0] ?? null);
  }

  // One focus: plateau, or what the stage criteria still need.
  if (rec.areaId && rec.kind === 'programme') {
    const status = ruleStatusFor(d, rec.areaId);
    const bench = p.areas.find((a) => a.id === rec.areaId)?.benchmarkId;
    const pl = bench ? plateau(counted, bench, rec.areaId) : null;
    if (status && pl && !status.met) {
      lines.push(tryFill(t, 'plateau', { count: pl.count, value: pl.value, criteria: status.criteriaText, regression: p.regression[rec.areaId] ?? '' }));
    } else if (status?.met) {
      const to = p.stages.find((s) => s.id === status.rule.to)?.order ?? status.rule.to;
      lines.push(tryFill(t, 'advancementReady', { criteria: status.criteriaText, to }));
    } else if (status) {
      const to = p.stages.find((s) => s.id === status.rule.to)?.order ?? 'exit';
      lines.push(tryFill(t, 'stillNeeded', { to, criteria: `${status.criteriaText} (${status.qualifying} of ${status.needed})` }));
    }
    // One unlock.
    if (countedNow && rec.status === 'completed' && prog?.next && !prog.awaitingAdvancement) lines.push(tryFill(t, 'unlocked', { area, next: prog.next }));
  }
  return lines.filter((x): x is string => !!x);
}

export function Summary({ runId }: { runId: string }) {
  const d = useData();
  const { go } = useNav();
  const recs = d.records.filter((r) => r.runId === runId);
  const [report, setReport] = useState('');
  const [reported, setReported] = useState(false);
  const spoken = useRef(false);

  useEffect(() => {
    if (spoken.current || !recs.length) return;
    spoken.current = true;
    setSoundSettings(d.settings.sound, d.programme.voiceStyles);
    if (d.settings.sound.endOfSessionLine) {
      const first = summaryLines(d, recs[0])[0];
      if (first) say(first);
    }
  }, [d, recs]);

  if (!recs.length) return <div className="page">Saving…</div>;

  async function keep(rec: SessionRecord) {
    await db.sessionRecords.put(promote(rec, new Date()));
    await logHistory('player', 'keep trial', `${rec.areaId ?? rec.kind} S${rec.sessionNumber ?? ''} kept`);
    await recordMilestones(d.programme);
  }

  async function sendReport(rec: SessionRecord) {
    await db.problemReports.add({
      sessionRecordId: rec.id,
      date: new Date().toISOString(),
      note: report.trim(),
      appVersion: APP_VERSION,
      contentVersion: d.programme.version,
      cameraSetupVersion: rec.cameraSetupVersion,
    });
    setReported(true);
  }

  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ margin: 0 }}>Session saved</h1>
        <button className="btn go xl" onClick={() => go({ name: 'home' })}>
          Done
        </button>
      </div>
      <RunScorecards recordIds={recs.map((r) => r.id)} />
      {recs.map((rec) => (
        <div key={rec.id} className="card stack" style={{ marginBottom: 16 }}>
          <div className="row spread">
            <h2 style={{ margin: 0 }}>
              {rec.areaId ? areaName(d.programme, rec.areaId) : rec.kind === 'anchor' ? 'Anchor check' : 'Extra'}
              {rec.sessionNumber ? ` · Session ${rec.sessionNumber}` : rec.kind === 'baseline' ? ' · Baseline' : ''}
            </h2>
            <StatusPill status={rec.status} trial={rec.trial && !rec.promotedAt} />
          </div>
          {summaryLines(d, rec).map((l, i) => (
            <p key={i} style={{ fontSize: i === 0 ? '1.4rem' : undefined }}>
              {l}
            </p>
          ))}
          {rec.blocks.some((b) => b.clipError) ? (
            <p className="muted" data-testid="clip-errors">
              {[...new Set(rec.blocks.map((b) => b.clipError).filter(Boolean))].join(' ')} The session itself is saved.
            </p>
          ) : null}
          {rec.trial && !rec.promotedAt ? (
            <div className="row">
              <button className="btn primary" onClick={() => keep(rec)}>
                Keep this
              </button>
            </div>
          ) : null}
          {rec.trial ? (
            <div className="stack">
              {reported ? (
                <p className="muted">Problem report saved. It is included in the next backup for the coding agent.</p>
              ) : (
                <div className="row">
                  <input type="text" placeholder="Report a problem (what went wrong?)" value={report} onChange={(e) => setReport(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn" disabled={!report.trim()} onClick={() => sendReport(rec)}>
                    Report a problem
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
