import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { logHistory, useData } from '../../app/data';
import { db } from '../../db/db';
import type { LearningComponent, LearningSettings } from '../../db/types';
import { activate, activeVersion, freezeValidation, proposeCandidate, rollback, type ThresholdModel } from '../../learning/service';
import { fmtDate } from '../../ui/widgets';

/** Base (unpersonalised) rules each component starts from, and the feature its statistical head uses. */
const COMPONENTS: { id: LearningComponent; label: string; feature?: string; base?: ThresholdModel; note: string }[] = [
  { id: 'feintExecution', label: 'Feint execution (visible fake)', feature: 'fakeShift', base: { feature: 'fakeShift', threshold: 0.12, direction: 1 }, note: 'Labels from flagged-rep reviews (fake 0–2).' },
  { id: 'ballRecognition', label: 'Ball recognition', note: 'Uses the registered ball profile; personalisation waits for part 17 validation data.' },
  { id: 'touchClassification', label: 'Touch classification', note: 'Waits for validated touch labels (part 17 §BR-04).' },
  { id: 'scanPattern', label: 'Scanning look (head turn)', feature: 'headTurn', base: { feature: 'headTurn', threshold: 0.35, direction: 1 }, note: 'Labels from flagged-rep reviews of scanning reps (looked before the touch: yes/no).' },
  { id: 'defenderTendency', label: 'Adaptive defender', note: 'Reads her habitual fake side from camera-seen reps; never used by the fixed benchmark opponent.' },
];

/** Parent → Learning (task 7.7): what is personalised, what it rests on, and how to pause, reset or roll back. */
export function LearningSection() {
  const { settings } = useData();
  const examples = useLiveQuery(() => db.learningExamples.toArray(), []) ?? [];
  const versions = useLiveQuery(() => db.modelVersions.toArray(), []) ?? [];
  const sets = useLiveQuery(() => db.validationDatasets.toArray(), []) ?? [];
  const ls = useLiveQuery(() => db.learningSettings.get('main'), []) ?? ({ id: 'main', paused: false, components: {} } as LearningSettings);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const saveLs = (next: LearningSettings) => db.learningSettings.put(next);
  return (
    <div className="stack">
      <div className="card stack">
        <p>
          Personalisation is {settings.flags.learning ? 'on' : 'off (Settings → Features)'}. Only reviewed, verified examples are used. A new model is used only if it does better on a frozen set of
          examples it never trained on; earlier models are kept, and scores keep the model version that produced them. Accuracy below is measured on that held-out set; it is not the app's confidence.
        </p>
        <label className="check">
          <input type="checkbox" checked={ls.paused} onChange={(e) => saveLs({ ...ls, paused: e.target.checked })} />
          Pause all personalisation
        </label>
      </div>
      {COMPONENTS.map((c) => {
        const mine = examples.filter((e) => e.component === c.id);
        const verified = mine.filter((e) => e.verified);
        const set = sets.find((s) => s.id === c.id);
        const act = activeVersion(versions, c.id);
        const hist = versions.filter((v) => v.component === c.id).sort((a, b) => b.n - a.n);
        const cs = ls.components[c.id] ?? { paused: false };
        return (
          <div key={c.id} className="card stack">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>{c.label}</h3>
              <span className="pill">{act ? `personalised v${act.n}` : 'base rules'}</span>
            </div>
            <p className="muted">{c.note}</p>
            <p>
              {verified.length} verified examples{cs.resetAt ? ` (counting from ${fmtDate(cs.resetAt)})` : ''} · validation set {set ? `${set.exampleIds.length} frozen ${fmtDate(set.frozenAt)}` : 'not frozen yet'}
              {verified.length < 30 ? ' · not enough data yet' : ''}
            </p>
            {hist.length ? (
              <ul className="clean">
                {hist.map((v) => (
                  <li key={v.id}>
                    v{v.n} · {fmtDate(v.createdAt)} · {v.status} · held-out {Math.round((v.heldOutAccuracy ?? 0) * 100)}% vs {Math.round((v.baseAccuracy ?? 0) * 100)}% before · {v.examplesUsed} examples
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={cs.paused} onChange={(e) => saveLs({ ...ls, components: { ...ls.components, [c.id]: { ...cs, paused: e.target.checked } } })} />
                Pause
              </label>
              {c.feature && c.base ? (
                <>
                  <button
                    className="btn small"
                    disabled={!!set}
                    onClick={async () => {
                      const v = freezeValidation(examples, c.id, new Date().toISOString());
                      if (!v) return setMsg({ ...msg, [c.id]: 'Not enough verified examples to freeze a validation set (needs 30).' });
                      await db.validationDatasets.put(v);
                      await db.learningExamples.bulkPut(examples.filter((e) => v.exampleIds.includes(e.id)).map((e) => ({ ...e, inValidationSet: true })));
                      await logHistory('parent', 'learning', `${c.label}: validation set frozen (${v.exampleIds.length})`);
                    }}
                  >
                    Freeze validation set
                  </button>
                  <button
                    className="btn small primary"
                    disabled={!settings.flags.learning}
                    onClick={async () => {
                      const r = proposeCandidate({ component: c.id, feature: c.feature!, base: c.base!, examples, validation: set, versions, settings: ls, now: new Date().toISOString() });
                      if (!r) return setMsg({ ...msg, [c.id]: 'No candidate: paused, no frozen validation set, or too few verified examples.' });
                      const next = activate(versions, r.candidate);
                      await db.modelVersions.bulkPut(next);
                      await logHistory('parent', 'learning', `${c.label}: candidate v${r.candidate.n} ${r.candidate.status} (${r.reason})`);
                      setMsg({ ...msg, [c.id]: `Candidate v${r.candidate.n} ${r.candidate.status === 'active' ? 'activated' : 'not used'}: ${r.reason}.` });
                    }}
                  >
                    Try a personalised model
                  </button>
                </>
              ) : null}
              <button
                className="btn small"
                disabled={!act}
                onClick={async () => {
                  await db.modelVersions.bulkPut(rollback(versions, c.id));
                  await logHistory('parent', 'learning', `${c.label}: rolled back from v${act!.n}`);
                }}
              >
                Roll back
              </button>
              <button
                className="btn small"
                onClick={async () => {
                  await saveLs({ ...ls, components: { ...ls.components, [c.id]: { ...cs, resetAt: new Date().toISOString() } } });
                  await db.modelVersions.bulkPut(versions.filter((v) => v.component === c.id && v.status === 'active').map((v) => ({ ...v, status: 'retired' as const })));
                  await logHistory('parent', 'learning', `${c.label}: learned profile reset (training history kept)`);
                }}
              >
                Reset learned profile
              </button>
            </div>
            {msg[c.id] ? <div className="note-box">{msg[c.id]}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
