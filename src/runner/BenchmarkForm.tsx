import { useState } from 'react';
import type { BenchmarkValues, Conditions } from '../db/types';
import { Seg, Stepper } from '../ui/widgets';

// Logging (plan/02 §2.7, task 1.7, part 15 D10): a result card that is never pre-filled from an
// earlier session. Counts start blank and take one tap on a number; the slalom times come from
// this run's own timer (an estimate from the current block, shown as such) with large +/- to correct.

export type FormKind = 'SB' | 'FB' | 'DB' | 'CB' | 'CA' | 'A1' | 'A2' | 'A3' | 'A4';

const FB_ITEMS = ['sell', 'exit', 'eyes'] as const;
const FB_LABEL: Record<(typeof FB_ITEMS)[number], string> = { sell: 'fake', exit: 'exit', eyes: 'eyes' };
const B = Number.NaN; // blank: must be entered before the confirm

/** Blank values for a form (NaN = not entered yet). */
export function blankValues(kind: FormKind, cueLevel: string): BenchmarkValues {
  const digits = cueLevel === 'headup' ? B : undefined;
  switch (kind) {
    case 'SB':
      return { kind: 'SB', correct: B };
    case 'FB':
      return { kind: 'FB', left: { sell: B, exit: B, eyes: B }, right: { sell: B, exit: B, eyes: B } };
    case 'DB':
      return { kind: 'DB', right: { timeS: B, errors: B, digits }, left: { timeS: B, errors: B, digits } };
    case 'CB':
      return { kind: 'CB', cb1: { left: B, right: B }, cb2: { left: B, right: B } };
    case 'CA':
      return { kind: 'CA', correct: B, outOf: 16 };
    case 'A1':
      return { kind: 'A1', right: { timeS: B, errors: B }, left: { timeS: B, errors: B } };
    case 'A2':
      return { kind: 'A2', left: B, right: B };
    case 'A3':
      return { kind: 'A3', correct: B, early: B };
    case 'A4':
      return { kind: 'A4', correct: B };
  }
}

/** Starting values: blank, with this run's own timed laps laid in (never an earlier session's numbers). */
export function initialValues(kind: FormKind, cueLevel: string, times?: { right?: number; left?: number }): BenchmarkValues {
  const v = blankValues(kind, cueLevel);
  if ((v.kind === 'DB' || v.kind === 'A1') && times) {
    return { ...v, right: { ...v.right, timeS: times.right ?? B }, left: { ...v.left, timeS: times.left ?? B } } as BenchmarkValues;
  }
  return v;
}

/** True when every number has been entered. */
export function complete(v: BenchmarkValues): boolean {
  const walk = (x: unknown): boolean => (typeof x === 'number' ? !Number.isNaN(x) : typeof x === 'object' && x !== null ? Object.values(x).every(walk) : true);
  return walk(v);
}

/** One tap on a number (0..max); above 12 a large +/- takes over. Blank until tapped. */
export function Count({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  const top = Math.min(max, 12);
  const blank = Number.isNaN(value);
  return (
    <div className="count" role="group" aria-label={label} data-blank={blank ? 'true' : undefined}>
      <span className="lbl">{label}</span>
      <div className="count-row">
        {Array.from({ length: top + 1 }, (_, n) => (
          <button type="button" key={n} aria-label={`${label} ${n}`} aria-pressed={value === n} className={value === n ? 'on' : ''} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
        {max > top ? (
          <>
            <button type="button" aria-label={`${label} more`} onClick={() => onChange(blank || value < top ? top + 1 : Math.min(max, value + 1))}>
              +
            </button>
            {!blank && value > top ? <span className="val">{value}</span> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** A timed value from this run: large +/- around the app's own reading; blank when the timer missed it. */
function TimeEntry({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  if (Number.isNaN(value)) {
    return (
      <div className="stepper" data-blank="true">
        <span className="lbl">{label}</span>
        <button type="button" aria-label={`${label} start`} onClick={() => onChange(10)}>
          Enter
        </button>
        <span className="val">—</span>
      </div>
    );
  }
  return <Stepper label={label} value={value} step={0.1} max={99} onChange={onChange} />;
}

export function BenchmarkForm(props: {
  kind: FormKind;
  title: string;
  conditions: Conditions;
  initial: BenchmarkValues;
  /** Whether the starting numbers include an estimate from this block (timed laps). */
  hasEstimate?: boolean;
  onSave: (values: BenchmarkValues, recordedBy: Conditions['recordedBy']) => void;
  onSkip?: () => void;
  saveLabel?: string;
}) {
  const { title, conditions, initial, hasEstimate, onSave, onSkip, saveLabel } = props;
  const [v, setV] = useState<BenchmarkValues>(initial);
  const [by, setBy] = useState<Conditions['recordedBy']>(conditions.recordedBy);
  const [saving, setSaving] = useState(false);
  const set = (next: BenchmarkValues) => setV(next);
  // A4 looks are optional: blank looks are dropped rather than blocking the confirm.
  const toSave: BenchmarkValues = v.kind === 'A4' && Number.isNaN(v.looks ?? Number.NaN) ? { kind: 'A4', correct: v.correct } : v;
  const ready = complete(toSave);

  let body: JSX.Element | null = null;
  if (v.kind === 'SB') {
    body = <Count label="Correct decisions /10" value={v.correct} max={10} onChange={(correct) => set({ ...v, correct })} />;
  } else if (v.kind === 'CA') {
    body = <Count label={`Correct /${v.outOf}`} value={v.correct} max={v.outOf} onChange={(correct) => set({ ...v, correct })} />;
  } else if (v.kind === 'FB') {
    body = (
      <div className="grid2">
        {(['right', 'left'] as const).map((side) => (
          <div key={side} className="stack">
            <strong>{side === 'right' ? 'Right exits (5 reps)' : 'Left exits (5 reps)'}</strong>
            {FB_ITEMS.map((item) => (
              <Count key={item} label={`${side === 'right' ? 'Right' : 'Left'} ${FB_LABEL[item]} /10`} value={v[side][item]} max={10} onChange={(n) => set({ ...v, [side]: { ...v[side], [item]: n } })} />
            ))}
          </div>
        ))}
      </div>
    );
  } else if (v.kind === 'DB' || v.kind === 'A1') {
    body = (
      <div className="grid2">
        {(['right', 'left'] as const).map((side) => {
          const x = v[side] as { timeS: number; errors: number; digits?: number };
          const upd = (patch: Partial<typeof x>) => set({ ...v, [side]: { ...x, ...patch } } as BenchmarkValues);
          return (
            <div key={side} className="stack">
              <strong>Pattern {side === 'right' ? 'R' : 'L'}</strong>
              <TimeEntry label={`Pattern ${side === 'right' ? 'R' : 'L'} time (s)`} value={x.timeS} onChange={(timeS) => upd({ timeS })} />
              <Count label={`Pattern ${side === 'right' ? 'R' : 'L'} control errors`} value={x.errors} max={30} onChange={(errors) => upd({ errors })} />
              {x.digits !== undefined ? <Count label={`Pattern ${side === 'right' ? 'R' : 'L'} digits /8`} value={x.digits} max={8} onChange={(digits) => upd({ digits })} /> : null}
            </div>
          );
        })}
      </div>
    );
  } else if (v.kind === 'CB') {
    body = (
      <div className="grid2">
        <div className="stack">
          <strong>CB-1 V-pulls, 30 s per foot</strong>
          <Count label="V-pulls right" value={v.cb1.right} max={60} onChange={(n) => set({ ...v, cb1: { ...v.cb1, right: n } })} />
          <Count label="V-pulls left" value={v.cb1.left} max={60} onChange={(n) => set({ ...v, cb1: { ...v.cb1, left: n } })} />
        </div>
        <div className="stack">
          <strong>CB-2 gate test, passes /5 per foot</strong>
          <Count label="Gate right /5" value={v.cb2.right} max={5} onChange={(n) => set({ ...v, cb2: { ...v.cb2, right: n } })} />
          <Count label="Gate left /5" value={v.cb2.left} max={5} onChange={(n) => set({ ...v, cb2: { ...v.cb2, left: n } })} />
        </div>
      </div>
    );
  } else if (v.kind === 'A2') {
    body = (
      <>
        <Count label="Right /5" value={v.right} max={5} onChange={(right) => set({ ...v, right })} />
        <Count label="Left /5" value={v.left} max={5} onChange={(left) => set({ ...v, left })} />
      </>
    );
  } else if (v.kind === 'A3') {
    body = (
      <>
        <Count label="Correct /16" value={v.correct} max={16} onChange={(correct) => set({ ...v, correct })} />
        <Count label="Possible early route commitments" value={v.early} max={16} onChange={(early) => set({ ...v, early })} />
      </>
    );
  } else if (v.kind === 'A4') {
    body = (
      <>
        <Count label="Correct /10" value={v.correct} max={10} onChange={(correct) => set({ ...v, correct })} />
        <Count label="Looks before touch /10 (optional)" value={v.looks ?? Number.NaN} max={10} onChange={(looks) => set({ ...v, looks })} />
      </>
    );
  }

  const layoutText = conditions.layoutVersion === 0 ? 'anchor layout (fixed)' : `layout v${conditions.layoutVersion}`;
  return (
    <div className="card stack">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="pill info">
          {layoutText} · level {conditions.cueLevel}
        </span>
      </div>
      <p className="muted">
        {hasEstimate ? "Times are this run's own timer readings (an estimate): correct them with +/- if needed. " : ''}Tap each number, then confirm. Nothing is carried over from earlier sessions.
      </p>
      {body}
      <div className="row">
        <span className="muted">Scored by</span>
        <Seg value={by} onChange={setBy} options={[{ value: 'parent', label: 'Parent' }, { value: 'self', label: 'Player' }]} />
      </div>
      <div className="row spread">
        {onSkip ? (
          <button className="btn" onClick={onSkip}>
            Skip benchmark
          </button>
        ) : (
          <span />
        )}
        <button
          className="btn primary xl"
          disabled={saving || !ready}
          onClick={() => {
            if (saving || !ready) return; // one result per tap, even on a double tap
            setSaving(true);
            onSave(toSave, by);
          }}
        >
          {saveLabel ?? 'Confirm'}
        </button>
      </div>
    </div>
  );
}
