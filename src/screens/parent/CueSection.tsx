import { useMemo, useState } from 'react';
import { logHistory, useData } from '../../app/data';
import type { CatchType, CueDrill } from '../../content/types';
import { initCue, tickCue, type CueState } from '../../cue/engine';
import { CueDisplay } from '../../cue/CueDisplay';
import { db } from '../../db/db';
import { fmtDate, Modal, Seg } from '../../ui/widgets';
import { useEffect, useRef } from 'react';
import { tone, unlockAudio } from '../../audio/audio';

const CATCH: { value: CatchType; label: string }[] = [
  { value: 'noCue', label: 'No cue (waits for permission?)' },
  { value: 'blockedShaping', label: 'BLOCKED on the shaping side' },
  { value: 'lateCue', label: 'Late cue (+600–900 ms)' },
];

function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    </label>
  );
}

/** 30-second preview of a cue drill, full screen, no recording. */
function Preview({ drill, onClose }: { drill: CueDrill; onClose: () => void }) {
  const start = useRef(Date.now());
  const st = useRef<CueState>(initCue({ drill, displayS: [drill.displayS ?? 1.5, drill.displayS ?? 1.5], reps: null, useTripwire: false, catchFraction: drill.catchFraction ?? 0, catchTypes: drill.catchTypes ?? [], secondCueFraction: drill.secondCue?.fraction ?? 0 }));
  const [, force] = useState(0);
  useEffect(() => {
    unlockAudio();
    const t = setInterval(() => {
      const now = Date.now() - start.current;
      if (now > 30_000) return onClose();
      const r = tickCue(st.current, now);
      st.current = r.state;
      r.actions.forEach((a) => a.type !== 'say' && tone(a.type === 'repTone' ? 'start' : 'cue'));
      force((n) => n + 1);
    }, 20);
    return () => clearInterval(t);
  }, [onClose]);
  return (
    <div className="practice cue" onClick={onClose}>
      <CueDisplay view={st.current.view} waiting="Preview: tap to close" />
    </div>
  );
}

function Editor({ drill, isNew, onDone }: { drill: CueDrill; isNew: boolean; onDone: () => void }) {
  const { programme: p } = useData();
  const [d, setD] = useState<CueDrill>(structuredClone(drill));
  const [values, setValues] = useState((drill.values ?? []).join(', '));
  const [preview, setPreview] = useState(false);
  const set = (patch: Partial<CueDrill>) => setD({ ...d, ...patch });
  const final: CueDrill = { ...d, values: values.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean) };
  const idTaken = isNew && p.cueDrills.some((c) => c.id === d.id);
  const ok = d.id.trim() && !idTaken && final.values!.length > 0 && d.name.trim();

  return (
    <div className="card stack">
      <div className="grid3">
        <label className="field">
          <span>Id{idTaken ? ' (already used)' : ''}</span>
          <input type="text" value={d.id} disabled={!isNew} onChange={(e) => set({ id: e.target.value.trim() })} />
        </label>
        <label className="field">
          <span>Name</span>
          <input type="text" value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Values shown (comma separated; LEFT/RIGHT/UP show as arrows; RED/BLUE/YELLOW/GREEN as colours)</span>
          <input type="text" value={values} onChange={(e) => setValues(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Rule (what she does)</span>
        <input type="text" value={d.rule} onChange={(e) => set({ rule: e.target.value })} />
      </label>
      <div className="row">
        <span className="muted">Timing</span>
        <Seg value={d.trigger ?? 'rep'} onChange={(trigger) => set({ trigger })} options={[{ value: 'rep', label: 'Per rep (start tone, then cue)' }, { value: 'interval', label: 'Every few seconds' }]} />
        <label className="check">
          <input type="checkbox" checked={!!d.numbers} onChange={(e) => set({ numbers: e.target.checked })} />
          Add a number (two-item read)
        </label>
      </div>
      {(d.trigger ?? 'rep') === 'rep' ? (
        <div className="grid3">
          <NumberField label="Reps per block (benchmarks, anchors)" value={d.reps} onChange={(reps) => set({ reps })} />
          <NumberField label="Seconds per rep" value={d.repPeriodS} step={0.5} onChange={(repPeriodS) => set({ repPeriodS })} />
          <NumberField label="Cue display (s)" value={d.displayS} step={0.1} onChange={(displayS) => set({ displayS })} />
          <NumberField label="No camera: start tone → cue, min (s)" value={d.startToCueMinS} step={0.1} onChange={(startToCueMinS) => set({ startToCueMinS })} />
          <NumberField label="No camera: start tone → cue, max (s)" value={d.startToCueMaxS} step={0.1} onChange={(startToCueMaxS) => set({ startToCueMaxS })} />
          <span />
          <NumberField label="Camera: tripwire → cue, min (ms)" value={d.tripwireDelayMinMs} step={50} onChange={(tripwireDelayMinMs) => set({ tripwireDelayMinMs })} />
          <NumberField label="Camera: tripwire → cue, max (ms)" value={d.tripwireDelayMaxMs} step={50} onChange={(tripwireDelayMaxMs) => set({ tripwireDelayMaxMs })} />
        </div>
      ) : (
        <div className="grid3">
          <NumberField label="Every (min s)" value={d.intervalMinS} step={0.5} onChange={(intervalMinS) => set({ intervalMinS })} />
          <NumberField label="Every (max s)" value={d.intervalMaxS} step={0.5} onChange={(intervalMaxS) => set({ intervalMaxS })} />
        </div>
      )}
      <div className="stack">
        <strong>Catch trials</strong>
        <NumberField label="Share of reps (0–0.5; plan/12 §12.6: 0 early Stage 3, 0.25 later)" value={d.catchFraction} step={0.05} onChange={(catchFraction) => set({ catchFraction })} />
        <div className="row">
          {CATCH.map((c) => (
            <label key={c.value} className="check">
              <input
                type="checkbox"
                checked={(d.catchTypes ?? []).includes(c.value)}
                onChange={(e) => set({ catchTypes: e.target.checked ? [...(d.catchTypes ?? []), c.value] : (d.catchTypes ?? []).filter((x) => x !== c.value) })}
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>
      <div className="stack">
        <label className="check">
          <input
            type="checkbox"
            checked={!!d.secondCue}
            onChange={(e) => set({ secondCue: e.target.checked ? { onValue: final.values![0] ?? 'HELD', fraction: 0.3, delayMinMs: 300, delayMaxMs: 600, values: final.values!.slice(1) } : undefined })}
          />
          Second cue (the defender recovers; Stage 4)
        </label>
        {d.secondCue ? (
          <div className="grid3">
            <label className="field">
              <span>After value</span>
              <input type="text" value={d.secondCue.onValue} onChange={(e) => set({ secondCue: { ...d.secondCue!, onValue: e.target.value.toUpperCase() } })} />
            </label>
            <NumberField label="Share of those reps" value={d.secondCue.fraction} step={0.05} onChange={(v) => set({ secondCue: { ...d.secondCue!, fraction: v ?? 0 } })} />
            <label className="field">
              <span>Second values (comma separated)</span>
              <input
                type="text"
                value={d.secondCue.values.join(', ')}
                onChange={(e) => set({ secondCue: { ...d.secondCue!, values: e.target.value.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean) } })}
              />
            </label>
            <NumberField label="Delay min (ms)" value={d.secondCue.delayMinMs} step={50} onChange={(v) => set({ secondCue: { ...d.secondCue!, delayMinMs: v ?? 300 } })} />
            <NumberField label="Delay max (ms)" value={d.secondCue.delayMaxMs} step={50} onChange={(v) => set({ secondCue: { ...d.secondCue!, delayMaxMs: v ?? 600 } })} />
          </div>
        ) : null}
      </div>
      <div className="row spread">
        <button className="btn" onClick={() => setPreview(true)}>
          Preview 30 s
        </button>
        <div className="row">
          <button className="btn" onClick={onDone}>
            Close
          </button>
          <button
            className="btn primary"
            disabled={!ok}
            onClick={async () => {
              await db.cueDrills.put({ id: final.id, date: new Date().toISOString(), author: 'coach via parent', drill: final });
              await logHistory('coach via parent', isNew ? 'new cue drill' : 'cue drill', `${final.id}: ${JSON.stringify(final).slice(0, 200)}`);
              onDone();
            }}
          >
            Save
          </button>
        </div>
      </div>
      {preview ? <Preview drill={final} onClose={() => setPreview(false)} /> : null}
    </div>
  );
}

export function CueSection() {
  const { programme: p, cueDrillOverrides, records } = useData();
  const [editing, setEditing] = useState<{ drill: CueDrill; isNew: boolean } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const usedBy = (id: string) => p.drills.filter((d) => d.cueDrillId === id).map((d) => d.id);
  const lastLogs = useMemo(
    () =>
      [...records]
        .reverse()
        .flatMap((r) => r.blocks.filter((b) => b.cueLog?.length).map((b) => ({ r, b })))
        .slice(0, 6),
    [records],
  );
  if (editing) return <Editor drill={editing.drill} isNew={editing.isNew} onDone={() => setEditing(null)} />;
  return (
    <div className="stack">
      <p className="muted">Cue drills run full screen in any drill linked to them. Changes are stored on this device; the content file keeps the original. Reset removes the change.</p>
      <div className="card">
        <table className="data">
          <tbody>
            {p.cueDrills.map((c) => {
              const ov = cueDrillOverrides.find((o) => o.id === c.id);
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong> <span className="muted">({c.id})</span>
                    <br />
                    {(c.values ?? []).join(' / ')} · {c.rule}
                    <br />
                    <span className="muted">
                      {(c.trigger ?? 'rep') === 'rep' ? `per rep · ${c.repPeriodS ?? 8} s · catch ${Math.round((c.catchFraction ?? 0) * 100)}%` : `every ${c.intervalMinS}–${c.intervalMaxS} s`}
                      {c.secondCue ? ` · second cue ${Math.round(c.secondCue.fraction * 100)}% of ${c.secondCue.onValue}` : ''} · used by {usedBy(c.id).join(', ') || '—'}
                      {ov ? ` · changed ${fmtDate(ov.date)}` : ''}
                    </span>
                  </td>
                  <td>
                    <div className="row">
                      <button className="btn small" onClick={() => setEditing({ drill: c, isNew: false })}>
                        Edit
                      </button>
                      {ov && p.cueDrills.some((x) => x.id === c.id) ? (
                        <button
                          className="btn small"
                          onClick={async () => {
                            await db.cueDrills.delete(c.id);
                            await logHistory('parent', 'cue drill reset', c.id);
                          }}
                        >
                          Reset
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn"
            onClick={() =>
              setEditing({
                isNew: true,
                drill: { id: 'cue-new', name: 'New cue drill', cueTypes: ['word'], values: ['GO', 'STOP'], rule: '', durationS: 120, soccerMeaning: '', trigger: 'rep', reps: 16, repPeriodS: 9, startToCueMinS: 1, startToCueMaxS: 2, tripwireDelayMinMs: 0, tripwireDelayMaxMs: 400, catchFraction: 0, catchTypes: [], displayS: 1.5 },
              })
            }
          >
            New cue drill
          </button>
          <button className="btn" onClick={() => setLogOpen(true)} disabled={!lastLogs.length}>
            Recent cue logs
          </button>
        </div>
      </div>
      {logOpen ? (
        <Modal onClose={() => setLogOpen(false)}>
          <h2>Recent cue logs</h2>
          <p className="muted">Times are seconds of block time (pauses excluded). Compare with the recording's beeps to check timing.</p>
          {lastLogs.map(({ r, b }, i) => (
            <div key={i} className="stack" style={{ marginBottom: 12 }}>
              <strong>
                {fmtDate(r.date)} · block {b.index + 1} {b.drillId ?? b.anchorId ?? b.benchmarkId} · {b.cueLevel}
              </strong>
              <table className="data">
                <tbody>
                  <tr>
                    <th>rep</th>
                    <th>start</th>
                    <th>tripwire</th>
                    <th>cue</th>
                    <th>value</th>
                    <th>catch</th>
                    <th>second</th>
                  </tr>
                  {b.cueLog!.map((e) => (
                    <tr key={e.rep}>
                      <td>{e.rep + 1}</td>
                      <td className="mono">{(e.repStartMs / 1000).toFixed(2)}</td>
                      <td className="mono">{e.tripwireMs !== undefined ? (e.tripwireMs / 1000).toFixed(2) : e.missedTripwire ? 'missed' : '—'}</td>
                      <td className="mono">{e.cueMs !== undefined ? (e.cueMs / 1000).toFixed(2) : '—'}</td>
                      <td>
                        {e.value ?? ''}
                        {e.number !== undefined ? ` ${e.number}` : ''}
                        {e.side ? ` (${e.side})` : ''}
                      </td>
                      <td>{e.catchType ?? ''}</td>
                      <td>{e.secondValue ? `${e.secondValue} @ ${(e.secondCueMs! / 1000).toFixed(2)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Modal>
      ) : null}
    </div>
  );
}
