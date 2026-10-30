import { useState } from 'react';
import { logHistory } from '../../app/data';
import type { RepAnalysis } from '../../analysis/types';
import { db } from '../../db/db';
import type { Clip, FeintRep } from '../../db/types';
import { acceptExample } from '../../learning/service';
import { Seg } from '../../ui/widgets';

/** Parent/coach review of a flagged rep (part 16 §4, part 18 §labels): a 0–2 rubric and the exit seen on the replay.
 *  The answers verify the rep and become labelled examples for learning; nothing else ever does. */
export function RepReview({ clip, rep, feint }: { clip: Clip; rep: RepAnalysis; feint?: FeintRep }) {
  return rep.looksBeforeTouch !== undefined && rep.fakeShiftHipWidths === undefined ? <ScanRepReview clip={clip} rep={rep} /> : <FeintRepReview clip={clip} rep={rep} feint={feint} />;
}

function FeintRepReview({ clip, rep, feint }: { clip: Clip; rep: RepAnalysis; feint?: FeintRep }) {
  const [fake, setFake] = useState<number | null>(feint?.techniqueRubric?.fake ?? null);
  const [exit, setExit] = useState<number | null>(feint?.techniqueRubric?.exit ?? null);
  const [eyes, setEyes] = useState<number | null>(feint?.techniqueRubric?.eyes ?? null);
  const [side, setSide] = useState<'left' | 'right' | 'none' | null>(null);
  const [saved, setSaved] = useState(!!feint?.techniqueRubric);
  const opts = [0, 1, 2].map((n) => ({ value: n, label: String(n) }));
  const ready = fake !== null && exit !== null && eyes !== null && side !== null;
  async function save() {
    if (!ready) return;
    const now = new Date().toISOString();
    if (feint) await db.feintReps.update(feint.repId, { techniqueRubric: { fake: fake!, exit: exit!, eyes: eyes! }, techniqueStatus: 'coachVerified' });
    const base = { createdAt: now, verified: true, labelSource: 'flaggedRepReview' as const, sessionRecordId: clip.sessionRecordId, context: { layoutVersion: undefined }, inValidationSet: false };
    const examples = [];
    if (rep.fakeShiftHipWidths !== undefined) {
      examples.push(acceptExample({ ...base, id: `${clip.id}:${rep.repIndex}:fake`, component: 'feintExecution', features: { fakeShift: rep.fakeShiftHipWidths, exitShift: rep.exitShiftHipWidths ?? 0, confidence: rep.confidence }, label: fake! >= 1 ? 'yes' : 'no' }));
    }
    if (rep.exitDir) {
      examples.push(acceptExample({ ...base, id: `${clip.id}:${rep.repIndex}:exit`, component: 'feintExecution', features: { exitAgrees: rep.exitDir === side ? 1 : 0, confidence: rep.confidence }, label: rep.exitDir === side ? 'yes' : 'no' }));
    }
    if (examples.length) await db.learningExamples.bulkPut(examples);
    await logHistory('parent', 'rep review', `${clip.blockLabel} rep ${rep.repIndex + 1}: fake ${fake}, exit ${exit}, eyes ${eyes}; exit seen ${side}`);
    setSaved(true);
  }
  return (
    <div className="card tight stack">
      <strong>Review rep {rep.repIndex + 1}</strong>
      <div className="row">
        <span className="muted">Fake (0–2)</span>
        <Seg value={fake ?? -1} onChange={setFake} options={opts} />
        <span className="muted">Exit (0–2)</span>
        <Seg value={exit ?? -1} onChange={setExit} options={opts} />
        <span className="muted">Eyes (0–2)</span>
        <Seg value={eyes ?? -1} onChange={setEyes} options={opts} />
      </div>
      <div className="row">
        <span className="muted">Exit seen on the replay</span>
        <Seg value={side ?? 'x'} onChange={(v) => setSide(v as 'left' | 'right' | 'none')} options={[{ value: 'left', label: "Player's left" }, { value: 'right', label: "Player's right" }, { value: 'none', label: 'No exit' }]} />
        <button className="btn small primary" disabled={!ready || saved} onClick={save}>
          {saved ? 'Reviewed' : 'Save review'}
        </button>
      </div>
    </div>
  );
}

/** Scanning rep: did the player look over the shoulder before the touch? The answer verifies the look and labels the scanning model. */
function ScanRepReview({ clip, rep }: { clip: Clip; rep: RepAnalysis }) {
  const [looked, setLooked] = useState<'yes' | 'no' | null>(null);
  const [saved, setSaved] = useState(false);
  async function save() {
    if (!looked) return;
    const now = new Date().toISOString();
    if (rep.maxHeadTurn !== undefined) {
      await db.learningExamples.put(
        acceptExample({ id: `${clip.id}:${rep.repIndex}:look`, component: 'scanPattern', createdAt: now, verified: true, labelSource: 'flaggedRepReview', sessionRecordId: clip.sessionRecordId, context: { layoutVersion: undefined }, inValidationSet: false, features: { headTurn: rep.maxHeadTurn, confidence: rep.confidence }, label: looked }),
      );
    }
    await logHistory('parent', 'rep review', `${clip.blockLabel} rep ${rep.repIndex + 1}: looked before the touch ${looked} (camera counted ${rep.looksBeforeTouch})`);
    setSaved(true);
  }
  return (
    <div className="card tight stack">
      <strong>Review rep {rep.repIndex + 1}</strong>
      <div className="row">
        <span className="muted">Looked over the shoulder before the touch (on the replay)?</span>
        <Seg value={looked ?? 'x'} onChange={(v) => setLooked(v as 'yes' | 'no')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
        <span className="muted">Camera: {rep.looksBeforeTouch ? `${rep.looksBeforeTouch} look${rep.looksBeforeTouch === 1 ? '' : 's'}` : 'no look'}</span>
        <button className="btn small primary" disabled={!looked || saved} onClick={save}>
          {saved ? 'Reviewed' : 'Save review'}
        </button>
      </div>
    </div>
  );
}
