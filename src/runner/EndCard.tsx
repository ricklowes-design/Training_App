import { focusFor, metricLabel } from '../domain/focus';
import { useEffect, useState } from 'react';
import { useData } from '../app/data';
import type { BenchmarkResult, BlockResult } from '../db/types';
import { lastComparable } from '../domain/comparability';
import { comparisonSentences, resultLines } from '../domain/metrics';
import type { RunBlock } from '../domain/plans';
import { countedResults, isRecorded } from '../domain/records';
import { tryFill } from '../domain/templates';
import { fmtClock, fmtDate } from '../ui/widgets';
import { LiveScorecard } from '../analysis/Scorecard';

/** End-of-drill progress card (plan/13 §13.2): this block's numbers, last time's at the same conditions, Repeat / Next. */
export function EndCard(props: {
  block: RunBlock;
  title: string;
  attempts: BlockResult[]; // all attempts of this block in this run, oldest first
  saved: BenchmarkResult[]; // results logged for this block in this run, oldest first
  runId: string;
  trial: boolean;
  autoAdvanceS: number | null; // null = wait for a tap
  phaseStartMs: number;
  onRepeat: () => void;
  onNext: () => void;
  onKeep?: () => void;
  kept: boolean;
  onNote: (text: string) => void;
  extraLine?: string;
  recordId?: string;
}) {
  const { block, title, attempts, saved, runId, trial, autoAdvanceS, phaseStartMs, onRepeat, onNext, onKeep, kept, onNote, extraLine, recordId } = props;
  const { programme: p, records, results } = useData();
  const [now, setNow] = useState(Date.now());
  const [shownAt] = useState(() => Math.max(Date.now(), phaseStartMs));
  const [noteOpen, setNoteOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const focus = focusFor(p, block.drillId);
  const [note, setNote] = useState('');
  const t = p.feedbackTemplates;

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, []);
  const left = autoAdvanceS === null || noteOpen ? null : Math.max(0, Math.ceil(autoAdvanceS - (now - shownAt) / 1000));
  useEffect(() => {
    if (left === 0) onNext();
  }, [left, onNext]);

  // Practice rounds are never scored attempts (Brief R15): listed apart, never as "attempt 0".
  const scored = attempts.filter((a) => !a.practice);
  const practised = attempts.filter((a) => a.practice && !a.skipped);
  const current = scored[scored.length - 1] ?? attempts[attempts.length - 1];
  const lines: string[] = [];
  let thenLine: string | null = null;

  const latest = saved[saved.length - 1];
  if (latest) {
    const counted = countedResults(results, records);
    const prev = lastComparable(latest, counted.filter((r) => !saved.some((s) => s.id === r.id)));
    lines.push(resultLines(latest.values).map((l) => `${l.label} ${l.text}`).join(' · '));
    if (prev) thenLine = `Last time (${fmtDate(prev.date)}): ${resultLines(prev.values).map((l) => `${l.label} ${l.text}`).join(' · ')}`;
    const name = p.benchmarks.find((b) => b.id === latest.benchmarkId)?.name ?? p.anchors.find((a) => a.id === latest.benchmarkId)?.name ?? latest.benchmarkId;
    const sentences = comparisonSentences(t, name, latest.values, prev?.values, !!prev);
    if (prev) lines.push(...sentences);
  } else if (current) {
    lines.push(
      current.skipped
        ? `${title}: skipped.`
        : tryFill(t, 'blockDone', { drill: title, done: fmtClock(current.elapsedS), planned: fmtClock(current.plannedS) }) ?? `${title}: ${fmtClock(current.elapsedS)}`,
    );
    // Last time this drill was done in a recorded session (not this run).
    const prevRec = [...records]
      .reverse()
      .find((r) => r.runId !== runId && isRecorded(r) && r.blocks.some((b) => b.drillId === block.drillId && b.kind === block.kind && !b.skipped));
    const prevBlock = prevRec?.blocks.filter((b) => b.drillId === block.drillId && !b.skipped).pop();
    if (prevRec && prevBlock) {
      thenLine = tryFill(t, 'blockLast', { date: fmtDate(prevRec.date), value: `${fmtClock(prevBlock.elapsedS)} of ${fmtClock(prevBlock.plannedS)}${prevBlock.note ? ` · “${prevBlock.note}”` : ''}` });
    }
    if (current.note) lines.push(`Note: “${current.note}”`);
  }

  const attemptNo = current?.attempt ?? 1;
  return (
    <div className="endcard">
      <div className="row spread">
        <div className="title">{title}</div>
        <div className="then">
          attempt {attemptNo} today{trial ? ' · trial' : ''}
        </div>
      </div>
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? 'now' : 'then'}>
          {l}
        </div>
      ))}
      {extraLine ? <div className="then">{extraLine}</div> : null}
      {focus ? (
        <div className="then">
          Focus: {focus.primary.map(metricLabel).join(' and ')}{' '}
          <button className="btn small" aria-pressed={advanced} onClick={() => setAdvanced(!advanced)}>
            {advanced ? 'Basic' : 'Advanced'}
          </button>
        </div>
      ) : null}
      {focus && advanced ? (
        <div className="then" style={{ fontSize: '1rem' }}>
          Supporting: {focus.supporting.map(metricLabel).join(', ') || '—'} · Experimental (never moves a stage): {focus.experimental.map(metricLabel).join(', ') || '—'}
        </div>
      ) : null}
      {recordId && current ? <LiveScorecard sessionRecordId={recordId} blockIndex={current.index} attempt={current.attempt} /> : null}
      {thenLine ? <div className="then">{thenLine}</div> : null}
      {scored.length > 1 ? (
        <div className="then">
          Earlier today:{' '}
          {saved.length > 1
            ? saved
                .slice(0, -1)
                .map((s, i) => `attempt ${i + 1}: ${resultLines(s.values).map((l) => l.text).join(' · ')}`)
                .join(' | ')
            : scored
                .slice(0, -1)
                .map((a) => `attempt ${a.attempt}: ${a.skipped ? 'skipped' : fmtClock(a.elapsedS)}`)
                .join(' | ')}
        </div>
      ) : null}
      {practised.length ? (
        <div className="then" data-testid="practice-rounds">
          Practice (not scored): {practised.length} round{practised.length === 1 ? '' : 's'}
        </div>
      ) : null}
      <div className="row">
        {trial && onKeep ? (
          <button className="btn" disabled={kept} onClick={onKeep}>
            {kept ? 'Kept' : 'Keep this drill'}
          </button>
        ) : null}
        {!noteOpen ? (
          <button className="btn small ghost" onClick={() => setNoteOpen(true)}>
            Add a note
          </button>
        ) : (
          <div className="row" style={{ flex: 1 }}>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note on this block" style={{ flex: 1 }} autoFocus />
            <button
              className="btn"
              onClick={() => {
                if (note.trim()) onNote(note.trim());
                setNoteOpen(false);
              }}
            >
              Save note
            </button>
          </div>
        )}
      </div>
      <div className="actions">
        <button className="btn" onClick={onRepeat}>
          Repeat
        </button>
        <button className="btn go" onClick={onNext}>
          Next{left !== null ? ` (${left})` : ''}
        </button>
      </div>
    </div>
  );
}
