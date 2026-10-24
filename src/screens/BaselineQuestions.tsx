import { useState } from 'react';
import { logHistory, useData } from '../app/data';
import { useNav } from '../app/nav';
import { db } from '../db/db';
import { resultText } from '../domain/metrics';
import { areaName } from '../domain/plans';
import { proposePlacement } from '../domain/sequencing';
import { Seg } from '../ui/widgets';

/** After a baseline: the parent answers yes/no; the app proposes a start and explains why; the parent confirms or overrides (plan/02 §2.2). */
export function BaselineQuestions({ recordId }: { recordId: string }) {
  const d = useData();
  const { programme: p } = d;
  const { go } = useNav();
  const rec = d.records.find((r) => r.id === recordId);
  const bl = p.baselines.find((b) => b.areaId === rec?.areaId);
  const [answers, setAnswers] = useState<(boolean | null)[]>(() => (bl?.questions ?? []).map(() => null));
  const [override, setOverride] = useState<number | null>(null);
  if (!rec || !bl || !rec.areaId) return <div className="page">Baseline not found.</div>;
  const areaId = rec.areaId;
  const answered = answers.every((a) => a !== null);
  const proposal = answered ? proposePlacement(p, areaId, answers as boolean[]) : null;
  const results = d.results.filter((r) => r.sessionRecordId === rec.id);
  const total = p.sessions.filter((s) => s.areaId === areaId).length;

  async function confirm() {
    if (!proposal) return;
    const start = override ?? proposal.startSession;
    await db.placements.put({
      areaId,
      startSession: start,
      proposed: proposal.startSession,
      overridden: override !== null && override !== proposal.startSession,
      explanation: proposal.explanation,
      date: new Date().toISOString(),
      baselineRecordId: rec!.id,
    });
    await db.sessionRecords.update(rec!.id, { baselineAnswers: answers as boolean[] });
    await logHistory(
      'parent',
      'placement',
      `${areaName(p, areaId)}: start at Session ${start}${override !== null && override !== proposal.startSession ? ` (override; proposed ${proposal.startSession})` : ''}`,
    );
    go({ name: 'home' });
  }

  return (
    <div className="page">
      <h1>{areaName(p, areaId)} baseline · parent questions</h1>
      <div className="card stack">
        {results.length ? (
          results.map((r) => (
            <p key={r.id}>
              <strong>{r.benchmarkId}:</strong> {resultText(r.values)}
            </p>
          ))
        ) : (
          <p className="muted">No benchmark result was logged.</p>
        )}
        {bl.questions.map((q, i) => (
          <div key={i} className="row spread">
            <span style={{ flex: 1 }}>{q}</span>
            <Seg
              value={answers[i] === null ? '' : answers[i] ? 'yes' : 'no'}
              onChange={(v) => setAnswers(answers.map((a, j) => (j === i ? v === 'yes' : a)))}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
            />
          </div>
        ))}
        {proposal ? (
          <div className="note-box stack">
            <p>
              <strong>Proposed:</strong> {proposal.explanation}
            </p>
            <label className="field" style={{ maxWidth: 360 }}>
              <span>Start at session (change to override; overrides are logged)</span>
              <select value={override ?? proposal.startSession} onChange={(e) => setOverride(Number(e.target.value))}>
                {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Session {n} (Stage {p.stages.find((s) => s.sessions.includes(n))?.order})
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <div className="row spread">
          <button className="btn" onClick={() => go({ name: 'home' })}>
            Later
          </button>
          <button className="btn primary xl" disabled={!proposal} onClick={confirm}>
            Confirm placement
          </button>
        </div>
      </div>
    </div>
  );
}
