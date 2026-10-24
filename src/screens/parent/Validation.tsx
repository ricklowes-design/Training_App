import { useState } from 'react';
import { logHistory, useData } from '../../app/data';
import { db } from '../../db/db';
import { capstoneGates } from '../../domain/capstone';
import { fmtDate } from '../../ui/widgets';

/** Parent → Validation (plan/10, part 16 §12): blind comparisons of camera measures with the parent's own reading. */
export function ValidationSection() {
  const { programme: p, settings } = useData();
  const [form, setForm] = useState<Record<string, { reps: string; agreed: string; fp: string }>>({});
  const { gates } = capstoneGates(p, settings);
  return (
    <div className="stack">
      <p>
        Each camera measure stays an estimate, and never moves a stage, until it has been checked against your own reading of the recording. Record the result of each check here.
      </p>
      {p.capstone.components.map((c) => {
        const g = gates.find((x) => x.id === c.id)!;
        const f = form[c.id] ?? { reps: '', agreed: '', fp: '' };
        const set = (patch: Partial<typeof f>) => setForm({ ...form, [c.id]: { ...f, ...patch } });
        const v = settings.validations?.[c.id];
        return (
          <div key={c.id} className="card stack">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>{c.label}</h3>
              <span className={`pill ${g.passed ? 'go' : ''}`}>{g.passed ? 'validated' : 'estimate only'}</span>
            </div>
            <p className="muted">{c.procedure}</p>
            <p>
              {g.detail}
              {v ? ` · ${fmtDate(v.date)}${v.falsePositives !== undefined ? ` · ${v.falsePositives} false triggers` : ''}` : ''}
            </p>
            <div className="row">
              <label className="field" style={{ maxWidth: 140 }}>
                <span>Reps compared</span>
                <input type="number" min="0" value={f.reps} onChange={(e) => set({ reps: e.target.value })} aria-label={`${c.label}: reps compared`} />
              </label>
              <label className="field" style={{ maxWidth: 140 }}>
                <span>Agreed</span>
                <input type="number" min="0" value={f.agreed} onChange={(e) => set({ agreed: e.target.value })} aria-label={`${c.label}: agreed`} />
              </label>
              {c.id === 'onsetDetector' ? (
                <label className="field" style={{ maxWidth: 160 }}>
                  <span>False triggers (controls)</span>
                  <input type="number" min="0" value={f.fp} onChange={(e) => set({ fp: e.target.value })} />
                </label>
              ) : null}
              <button
                className="btn primary"
                disabled={!(Number(f.reps) > 0) || f.agreed === '' || Number(f.agreed) > Number(f.reps)}
                onClick={async () => {
                  const rec = { date: new Date().toISOString(), reps: Number(f.reps), agreed: Number(f.agreed), falsePositives: f.fp === '' ? undefined : Number(f.fp) };
                  await db.settings.update('main', { validations: { ...settings.validations, [c.id]: rec } });
                  await logHistory('parent', 'validation', `${c.label}: ${rec.agreed}/${rec.reps}${rec.falsePositives !== undefined ? `, ${rec.falsePositives} false triggers` : ''}`);
                  set({ reps: '', agreed: '', fp: '' });
                }}
              >
                Save check
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
