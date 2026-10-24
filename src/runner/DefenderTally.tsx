import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import type { ContextKey, Conditions } from '../db/types';
import { Seg } from '../ui/widgets';
import { Count } from './BenchmarkForm';

/** After a defender block with no camera: the block's decisions, entered blank with one tap each (part 15 D10). Optional. */
export function DefenderTally({ title, reps, context, recordId, blockIndex, onDone }: { title: string; reps: number; context: ContextKey; recordId: string; blockIndex: number; onDone: () => void }) {
  const [right, setRight] = useState(Number.NaN);
  const [clean, setClean] = useState(Number.NaN);
  const [by, setBy] = useState<Conditions['recordedBy']>('parent');
  const [saving, setSaving] = useState(false);
  const ready = !Number.isNaN(right) && !Number.isNaN(clean);
  async function save() {
    if (!ready || saving) return;
    setSaving(true);
    const now = new Date().toISOString();
    // A parent's count is evidence; the player's own count is an estimate.
    const status = by === 'parent' ? 'verified' : 'estimate';
    await db.metricObservations.bulkAdd([
      { metricId: 'correctResponseByDefenderAction', sessionRecordId: recordId, blockIndex, value: right, unit: `/${reps}`, status, source: 'manual', contextKey: context, recordedAt: now },
      { metricId: 'controlledExit', sessionRecordId: recordId, blockIndex, value: clean, unit: `/${reps}`, status, source: 'manual', contextKey: context, recordedAt: now },
    ]);
    onDone();
  }
  return (
    <div className="card stack">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="pill info">no camera · {reps} reps</span>
      </div>
      <p className="muted">How many reps went the right way for what the defender did, and how many ended with the ball under control? Tap each number, or skip.</p>
      <Count label={`Right decisions /${reps}`} value={right} max={reps} onChange={setRight} />
      <Count label={`Clean controlled exits /${reps}`} value={clean} max={reps} onChange={setClean} />
      <div className="row">
        <span className="muted">Counted by</span>
        <Seg value={by} onChange={setBy} options={[{ value: 'parent', label: 'Parent' }, { value: 'self', label: 'Player' }]} />
      </div>
      <div className="row spread">
        <button className="btn" onClick={onDone}>
          Skip
        </button>
        <button className="btn primary xl" disabled={!ready || saving} onClick={save}>
          Confirm
        </button>
      </div>
    </div>
  );
}

/** After the optional digit diagnostic: numbers and directions, blank, one tap each. */
export function DiagnosticCard({
  context,
  recordId,
  blockIndex,
  onDone,
  speech,
}: {
  context: ContextKey;
  recordId: string;
  blockIndex: number;
  onDone: () => void;
  /** What Chrome heard in this block (experimental): a starting estimate only. */
  speech?: { correct: number; heardReps: number; reps: number; error?: string };
}) {
  // An estimate from the current block may start the card (D10); nothing from earlier sessions does.
  const [digits, setDigits] = useState(speech && speech.heardReps > 0 ? speech.correct : Number.NaN);
  // What was heard can arrive just after the card opens (the listener stops as the block ends).
  const touched = useRef(false);
  const estimate = speech && speech.heardReps > 0 ? speech.correct : undefined;
  useEffect(() => {
    if (estimate !== undefined && !touched.current) setDigits(estimate);
  }, [estimate]);
  const [dirs, setDirs] = useState(Number.NaN);
  const ready = !Number.isNaN(digits) && !Number.isNaN(dirs);
  async function save() {
    const now = new Date().toISOString();
    const ctx = { ...context, taskMode: 'digitDiagnostic' };
    await db.metricObservations.bulkAdd([
      { metricId: 'digitCorrect', sessionRecordId: recordId, blockIndex, value: digits, unit: '/10', status: 'estimate', source: 'manual', contextKey: ctx, recordedAt: now, detectorVersion: speech?.heardReps ? 'speech-estimate-confirmed' : undefined },
      { metricId: 'M8', sessionRecordId: recordId, blockIndex, value: dirs, unit: '/10', status: 'estimate', source: 'manual', contextKey: ctx, recordedAt: now },
    ]);
    onDone();
  }
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Scanning diagnostic</h2>
      <p className="muted">
        Right numbers but wrong directions points to interpretation or the move; wrong numbers points to the look itself. A diagnostic only: it never moves a stage.
      </p>
      {speech ? (
        <p className="pill info">
          {speech.heardReps
            ? `Speech (experimental): heard a number on ${speech.heardReps} of the first ${speech.reps} reps, ${speech.correct} right. A starting estimate: correct it if it is wrong.`
            : `Speech (experimental): nothing usable heard${speech.error ? ` (${speech.error})` : ''}. Enter the count by hand.`}
        </p>
      ) : null}
      <Count
        label="Numbers right /10"
        value={digits}
        max={10}
        onChange={(v) => {
          touched.current = true;
          setDigits(v);
        }}
      />
      <Count label="Directions right /10" value={dirs} max={10} onChange={setDirs} />
      <div className="row spread">
        <button className="btn" onClick={onDone}>
          Skip
        </button>
        <button className="btn primary xl" disabled={!ready} onClick={save}>
          Confirm
        </button>
      </div>
    </div>
  );
}
