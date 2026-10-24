import { areaProgress } from '../../domain/sequencing';
import { useState } from 'react';
import { logHistory, useData } from '../../app/data';
import { useNav } from '../../app/nav';
import type { ContentBlock, Drill } from '../../content/types';
import { db } from '../../db/db';
import type { NoteTarget } from '../../db/types';
import { recordMilestones } from '../../domain/milestoneStore';
import { currentValue } from '../../domain/overrides';
import { areaName, planMinutes } from '../../domain/plans';
import { resultText } from '../../domain/metrics';
import { fmtDate, Modal, Seg } from '../../ui/widgets';
import { ruleStatusFor } from '../helpers';

const AUTHOR_OPTIONS = [
  { value: 'coach via parent', label: 'Coach via parent' },
  { value: 'coach', label: 'Coach' },
  { value: 'parent', label: 'Parent' },
];

function useAuthor(): [string, JSX.Element] {
  const [author, setAuthor] = useState('coach via parent');
  return [
    author,
    <div className="row" key="author">
      <span className="muted">Author</span>
      <Seg value={author} onChange={setAuthor} options={AUTHOR_OPTIONS} />
    </div>,
  ];
}

export function NotesSection() {
  const { programme: p, notes } = useData();
  const [kind, setKind] = useState<NoteTarget['kind']>('drill');
  const [target, setTarget] = useState(p.drills[0].id);
  const [body, setBody] = useState('');
  const [author, authorPicker] = useAuthor();
  const options =
    kind === 'drill'
      ? p.drills.map((d) => ({ id: d.id, label: `${d.id} ${d.name}` }))
      : kind === 'session'
        ? p.sessions.map((s) => ({ id: s.id, label: `${areaName(p, s.areaId)} S${s.number}` }))
        : [{ id: 'all', label: 'All areas' }, ...p.areas.map((a) => ({ id: a.id, label: a.name }))];
  const label = (t: NoteTarget) =>
    t.kind === 'drill' ? `${t.id} ${p.drills.find((d) => d.id === t.id)?.name ?? ''}` : t.kind === 'area' ? (t.id === 'all' ? 'All areas' : areaName(p, t.id)) : t.id;
  return (
    <div className="stack">
      <div className="card stack">
        <h2>New note</h2>
        <div className="row">
          <Seg
            value={kind}
            onChange={(k) => {
              setKind(k);
              setTarget(k === 'drill' ? p.drills[0].id : k === 'session' ? p.sessions[0].id : 'all');
            }}
            options={[
              { value: 'drill', label: 'Drill' },
              { value: 'session', label: 'Session' },
              { value: 'area', label: 'Area' },
            ]}
          />
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ maxWidth: 360 }}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {authorPicker}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Smaller scissors, faster exit touch." />
        <div className="row">
          <button
            className="btn primary"
            disabled={!body.trim()}
            onClick={async () => {
              await db.coachNotes.add({ date: new Date().toISOString(), author, target: { kind, id: target }, body: body.trim() });
              await logHistory(author, 'note', `${kind} ${target}: ${body.trim()}`);
              setBody('');
            }}
          >
            Save note
          </button>
          <span className="muted">Drill notes show in that drill's demo view until marked resolved.</span>
        </div>
      </div>
      <div className="card">
        <h2>Notes</h2>
        <ul className="clean">
          {[...notes]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((n) => (
              <li key={n.id} className={`row spread ${n.resolvedAt ? 'greyed' : ''}`}>
                <span>
                  {fmtDate(n.date)} · {label(n.target)} · <em>{n.author}</em>: “{n.body}”
                </span>
                {!n.resolvedAt ? (
                  <button className="btn small" onClick={() => db.coachNotes.update(n.id!, { resolvedAt: new Date().toISOString() })}>
                    Mark resolved
                  </button>
                ) : (
                  <span className="muted">resolved {fmtDate(n.resolvedAt)}</span>
                )}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

function DrillEditor({ drill }: { drill: Drill }) {
  const { programme: p } = useData();
  const [author, authorPicker] = useAuthor();
  const [f, setF] = useState({
    name: drill.name,
    purpose: drill.purpose,
    setupText: drill.setupText,
    prescription: drill.prescription,
    cues: drill.cues.join('\n'),
    commonErrors: drill.commonErrors.join('\n'),
    mode: drill.mode,
  });
  const [msg, setMsg] = useState('');

  async function save() {
    const next: Record<string, unknown> = { ...f, cues: lines(f.cues), commonErrors: lines(f.commonErrors) };
    let changed = 0;
    for (const [field, value] of Object.entries(next)) {
      const prev = currentValue(p, { kind: 'drill', id: drill.id }, field);
      if (JSON.stringify(prev) === JSON.stringify(value)) continue;
      await db.overrides.add({ date: new Date().toISOString(), author, target: { kind: 'drill', id: drill.id }, field, value, previousValue: prev });
      await logHistory(author, 'adjust drill', `${drill.id} ${field}: ${JSON.stringify(prev)} → ${JSON.stringify(value)}`);
      changed++;
    }
    setMsg(changed ? `${changed} change${changed > 1 ? 's' : ''} saved. The original stays in the content file; revert from History.` : 'No changes.');
  }

  const field = (key: keyof typeof f, label: string, multi = false) => (
    <label className="field">
      <span>{label}</span>
      {multi ? <textarea value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} /> : <input type="text" value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} />}
    </label>
  );
  return (
    <div className="card stack">
      <h2>
        {drill.id} · {drill.name}
      </h2>
      {field('name', 'Name')}
      {field('purpose', 'Purpose')}
      {field('setupText', 'Set-up')}
      {field('prescription', 'Prescription (reps, work/rest)', true)}
      {field('cues', 'Coaching cues (one per line)', true)}
      {field('commonErrors', 'Common errors (one per line)', true)}
      <div className="row">
        <span className="muted">Block type</span>
        <Seg
          value={f.mode}
          onChange={(mode) => setF({ ...f, mode })}
          options={[
            { value: 'reps', label: 'Rep-based (DONE allowed after 80%)' },
            { value: 'timed', label: 'Timed (runs to the end)' },
          ]}
        />
      </div>
      {authorPicker}
      <div className="row">
        <button className="btn primary" onClick={save}>
          Save changes
        </button>
        <span className="muted">{msg}</span>
      </div>
    </div>
  );
}

function NewDrill({ onDone }: { onDone: () => void }) {
  const { programme: p } = useData();
  const [author, authorPicker] = useAuthor();
  const [d, setD] = useState({ id: '', areaId: p.areas[0].id, name: '', layoutId: Object.keys(p.layouts)[0], purpose: '', setupText: '', prescription: '', cues: '', errors: '', mode: 'reps' as Drill['mode'] });
  const taken = p.drills.some((x) => x.id === d.id.trim());
  const ok = d.id.trim() && !taken && d.name.trim() && d.prescription.trim();
  return (
    <Modal onClose={onDone}>
      <h2>New drill</h2>
      <div className="stack">
        <div className="grid2">
          <label className="field">
            <span>Id (e.g. F9){taken ? ' — already used' : ''}</span>
            <input type="text" value={d.id} onChange={(e) => setD({ ...d, id: e.target.value.toUpperCase() })} />
          </label>
          <label className="field">
            <span>Area</span>
            <select value={d.areaId} onChange={(e) => setD({ ...d, areaId: e.target.value })}>
              {p.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Name</span>
          <input type="text" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Layout</span>
          <select value={d.layoutId} onChange={(e) => setD({ ...d, layoutId: e.target.value })}>
            {Object.entries(p.layouts).map(([id, l]) => (
              <option key={id} value={id}>
                {id} {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Purpose</span>
          <input type="text" value={d.purpose} onChange={(e) => setD({ ...d, purpose: e.target.value })} />
        </label>
        <label className="field">
          <span>Set-up</span>
          <input type="text" value={d.setupText} onChange={(e) => setD({ ...d, setupText: e.target.value })} />
        </label>
        <label className="field">
          <span>Prescription</span>
          <textarea value={d.prescription} onChange={(e) => setD({ ...d, prescription: e.target.value })} />
        </label>
        <label className="field">
          <span>Cues (one per line)</span>
          <textarea value={d.cues} onChange={(e) => setD({ ...d, cues: e.target.value })} />
        </label>
        <label className="field">
          <span>Common errors (one per line)</span>
          <textarea value={d.errors} onChange={(e) => setD({ ...d, errors: e.target.value })} />
        </label>
        {authorPicker}
        <div className="row spread">
          <button className="btn" onClick={onDone}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!ok}
            onClick={async () => {
              const drill: Drill = {
                id: d.id.trim(),
                areaId: d.areaId,
                name: d.name.trim(),
                layoutId: d.layoutId,
                purpose: d.purpose.trim(),
                setupText: d.setupText.trim(),
                prescription: d.prescription.trim(),
                cues: lines(d.cues),
                commonErrors: lines(d.errors),
                demo: { type: 'none', ref: '', ownDemoPlanned: true, outsideSearchPhrase: null, outsideMustShow: null, status: 'demonstration unverified' },
                safety: 'Clear 0.5 m around gates and stop zones',
                variants: { solo: true, partner: null },
                mode: d.mode,
              };
              await db.customDrills.put({ id: drill.id, date: new Date().toISOString(), author, drill });
              await logHistory(author, 'new drill', `${drill.id} ${drill.name}`);
              onDone();
            }}
          >
            Create drill
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function DrillsSection({ drillId }: { drillId?: string }) {
  const { programme: p } = useData();
  const { go } = useNav();
  const [creating, setCreating] = useState(false);
  const drill = p.drills.find((d) => d.id === drillId);
  return (
    <div className="stack">
      <div className="row">
        <select value={drillId ?? ''} onChange={(e) => go({ name: 'parent', section: 'drills', arg: e.target.value || undefined })} style={{ maxWidth: 420 }}>
          <option value="">Pick a drill to adjust…</option>
          {p.drills.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id} {d.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setCreating(true)}>
          New drill
        </button>
      </div>
      {drill ? <DrillEditor key={drill.id} drill={drill} /> : null}
      {creating ? <NewDrill onDone={() => setCreating(false)} /> : null}
    </div>
  );
}

export function SessionsSection({ sessionId }: { sessionId?: string }) {
  const { programme: p } = useData();
  const { go } = useNav();
  const session = p.sessions.find((s) => s.id === sessionId);
  const [blocks, setBlocks] = useState<ContentBlock[] | null>(null);
  const [author, authorPicker] = useAuthor();
  const [msg, setMsg] = useState('');
  const current = blocks ?? session?.blocks ?? [];
  const total = planMinutes(current);
  const update = (i: number, b: ContentBlock | null) => setBlocks(current.flatMap((x, j) => (j === i ? (b ? [b] : []) : [x])));

  return (
    <div className="stack">
      <select
        value={sessionId ?? ''}
        onChange={(e) => {
          setBlocks(null);
          setMsg('');
          go({ name: 'parent', section: 'sessions', arg: e.target.value || undefined });
        }}
        style={{ maxWidth: 420 }}
      >
        <option value="">Pick a session…</option>
        {p.sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {areaName(p, s.areaId)} S{s.number}
          </option>
        ))}
      </select>
      {session ? (
        <div className="card stack">
          <h2>
            {areaName(p, session.areaId)} Session {session.number}
          </h2>
          <table className="data">
            <tbody>
              {current.map((b, i) => (
                <tr key={i}>
                  <td>{b.type}</td>
                  <td>
                    {b.type === 'work' ? (
                      <select value={b.drillId} onChange={(e) => update(i, { ...b, drillId: e.target.value })}>
                        <option value="choice">Player's choice</option>
                        {p.drills.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.id} {d.name}
                          </option>
                        ))}
                      </select>
                    ) : b.type === 'benchmark' ? (
                      `${b.benchmarkId} level ${b.cueLevel}`
                    ) : (
                      ''
                    )}
                  </td>
                  <td>{b.type === 'work' ? <input type="text" value={b.params} onChange={(e) => update(i, { ...b, params: e.target.value })} placeholder="params" /> : null}</td>
                  <td>
                    <input type="number" min={1} value={b.minutes} onChange={(e) => update(i, { ...b, minutes: Number(e.target.value) } as ContentBlock)} style={{ width: 80 }} />
                  </td>
                  <td>
                    {b.type === 'work' ? (
                      <button className="btn small" onClick={() => update(i, null)}>
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button
              className="btn small"
              onClick={() => {
                const at = Math.max(0, current.findIndex((b) => b.type === 'log'));
                const copy = [...current];
                copy.splice(at, 0, { type: 'work', minutes: 3, drillId: p.drills.find((d) => d.areaId === session.areaId)?.id ?? p.drills[0].id, params: '' });
                setBlocks(copy);
              }}
            >
              Add a drill block
            </button>
            <span className={total === session.durationMinutes ? 'muted' : 'pill stop'}>
              Total {total} of {session.durationMinutes} min{total === session.durationMinutes ? '' : ' — must equal the session length'}
            </span>
          </div>
          {authorPicker}
          <div className="row">
            <button
              className="btn primary"
              disabled={!blocks || total !== session.durationMinutes}
              onClick={async () => {
                await db.overrides.add({ date: new Date().toISOString(), author, target: { kind: 'session', id: session.id }, field: 'blocks', value: current, previousValue: session.blocks });
                await logHistory(author, 'session blocks', `${session.id}: ${current.map((b) => (b.type === 'work' ? b.drillId : b.type)).join(', ')}`);
                setBlocks(null);
                setMsg('Saved.');
              }}
            >
              Save
            </button>
            <span className="muted">{msg}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PrioritiesSection() {
  const { programme: p, settings } = useData();
  const tags = [...new Set([...p.priorities, ...p.areas.flatMap((a) => a.priorityTags)])];
  return (
    <div className="card stack">
      <p className="muted">Priority skills show as a tag on the Skills tab and bias the next-session suggestion.</p>
      {tags.map((t) => (
        <label key={t} className="check">
          <input
            type="checkbox"
            checked={settings.priorities.includes(t)}
            onChange={async (e) => {
              const priorities = e.target.checked ? [...settings.priorities, t] : settings.priorities.filter((x) => x !== t);
              await db.settings.update('main', { priorities });
              await logHistory('parent', 'priorities', priorities.join(', '));
            }}
          />
          {t}{' '}
          <span className="muted">
            ({p.areas
              .filter((a) => a.priorityTags.includes(t))
              .map((a) => areaName(p, a.id))
              .join(', ') || 'general'}
            )
          </span>
        </label>
      ))}
    </div>
  );
}

export function AdvancementSection() {
  const d = useData();
  const { programme: p, advancements, extraCriteria } = d;
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Record<string, string>>({});
  /** Sessions a confirmation would pass over, as "3–4", or '' when the stage is already finished. */
  const skipFrom = (areaId: string, to: string): string => {
    const prog = areaProgress(p, areaId, d.placements.find((x) => x.areaId === areaId), d.records, d.advancements);
    const first = Math.min(...(p.stages.find((x) => x.id === to)?.sessions ?? [0]));
    if (prog.next === null || prog.next >= first) return '';
    return prog.next === first - 1 ? String(prog.next) : `${prog.next}–${first - 1}`;
  };
  return (
    <div className="stack">
      {p.areas.map((a) => {
        const st = ruleStatusFor(d, a.id);
        if (!st) {
          return (
            <div key={a.id} className="card">
              <h3>{a.name}</h3>
              <p className="muted">{d.placements.some((x) => x.areaId === a.id) ? 'Area complete.' : 'Baseline not done.'}</p>
            </div>
          );
        }
        const key = `${a.id}:${st.rule.from}`;
        const parentChecks = st.rule.parentChecks ?? [];
        const allChecked = parentChecks.every((_, i) => checks[`${key}:${i}`]);
        const to = st.rule.to === 'exit' ? 'exit' : `Stage ${p.stages.find((s) => s.id === st.rule.to)?.order}`;
        const decide = async (decision: 'confirmed' | 'withheld', why?: string) => {
          await db.advancements.add({ areaId: a.id, from: st.rule.from, to: st.rule.to, date: new Date().toISOString(), decision, reason: why, criteriaText: st.criteriaText, author: 'parent' });
          await logHistory('parent', `advancement ${decision}`, `${a.name} ${st.rule.from} → ${st.rule.to}${why ? `: ${why}` : ''}`);
          await recordMilestones(p);
        };
        return (
          <div key={a.id} className="card stack">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>
                {a.name}: to {to}
              </h3>
              {st.met ? <span className="pill go">criteria met</span> : <span className="pill">not yet</span>}
            </div>
            <p>
              {st.criteriaText}
              {st.needed ? ` — qualifying tests on ${st.qualifying} of ${st.needed} different days` : ''}
              {st.rule.requiresTransfer ? ` · coach transfer note ${st.hasTransfer ? 'recorded' : 'needed'}` : ''}
            </p>
            {st.selfScoredIgnored ? <p className="muted">{st.selfScoredIgnored} passing result(s) were scored by the player alone; they are shown but are not evidence for advancement.</p> : null}
            {st.met && skipFrom(a.id, st.rule.to) ? <p className="pill info">Skip ahead: confirming passes over sessions {skipFrom(a.id, st.rule.to)}; they stay available to repeat.</p> : null}
            {st.latest ? <p className="muted">Latest: {fmtDate(st.latest.date)} {resultText(st.latest.values)} (level {st.latest.conditions.cueLevel})</p> : null}
            {st.withheld ? <p className="pill warn">Withheld {fmtDate(st.withheld.date)}: {st.withheld.reason}</p> : null}
            {extraCriteria
              .filter((x) => x.areaId === a.id && x.from === st.rule.from)
              .map((x) => (
                <div key={x.id} className="row spread">
                  <span>
                    Extra criterion: {x.text} {x.metAt ? <span className="pill go">met</span> : null}
                  </span>
                  {!x.metAt ? (
                    <button className="btn small" onClick={() => db.extraCriteria.update(x.id!, { metAt: new Date().toISOString() })}>
                      Mark met
                    </button>
                  ) : null}
                </div>
              ))}
            {parentChecks.map((c, i) => (
              <label key={i} className="check">
                <input type="checkbox" checked={!!checks[`${key}:${i}`]} onChange={(e) => setChecks({ ...checks, [`${key}:${i}`]: e.target.checked })} />
                {c}
              </label>
            ))}
            <div className="row">
              <button className="btn primary" disabled={!st.met || !allChecked} onClick={() => decide('confirmed')}>
                Confirm advancement
              </button>
              <input type="text" placeholder="Reason (to withhold or to advance anyway)" value={reason[key] ?? ''} onChange={(e) => setReason({ ...reason, [key]: e.target.value })} style={{ maxWidth: 360 }} />
              <button className="btn" disabled={!reason[key]?.trim()} onClick={() => decide('withheld', reason[key].trim())}>
                Withhold
              </button>
              <button className="btn ghost" disabled={st.met || !reason[key]?.trim()} onClick={() => decide('confirmed', `advanced without the criteria: ${reason[key].trim()}`)}>
                Advance anyway
              </button>
            </div>
            <div className="row">
              <input type="text" placeholder="Custom extra criterion" value={extra[key] ?? ''} onChange={(e) => setExtra({ ...extra, [key]: e.target.value })} style={{ maxWidth: 360 }} />
              <button
                className="btn small"
                disabled={!extra[key]?.trim()}
                onClick={async () => {
                  await db.extraCriteria.add({ areaId: a.id, from: st.rule.from, text: extra[key].trim(), date: new Date().toISOString() });
                  await logHistory('parent', 'extra criterion', `${a.name}: ${extra[key].trim()}`);
                  setExtra({ ...extra, [key]: '' });
                }}
              >
                Add criterion
              </button>
            </div>
          </div>
        );
      })}
      <div className="card">
        <h3>Decisions</h3>
        <ul className="clean">
          {[...advancements]
            .sort((x, y) => y.date.localeCompare(x.date))
            .map((x) => (
              <li key={x.id}>
                {fmtDate(x.date)} · {areaName(p, x.areaId)} {x.from} → {x.to}: {x.decision}
                {x.reason ? ` (${x.reason})` : ''}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

export function TransferSection() {
  const { programme: p, transfers } = useData();
  const [areaId, setAreaId] = useState(p.areas[0].id);
  const [seenOn, setSeenOn] = useState(new Date().toISOString().slice(0, 10));
  const [behaviour, setBehaviour] = useState('');
  const [author, authorPicker] = useAuthor();
  return (
    <div className="stack">
      <div className="card stack">
        <p className="muted">"Seen in training or a match on [date]: [behaviour]". This is the Stage 4 exit evidence.</p>
        <div className="grid2">
          <label className="field">
            <span>Area</span>
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              {p.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Seen on</span>
            <input type="date" value={seenOn} onChange={(e) => setSeenOn(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Behaviour seen</span>
          <input type="text" value={behaviour} onChange={(e) => setBehaviour(e.target.value)} placeholder="e.g. final look before receiving, twice in the second half" />
        </label>
        {authorPicker}
        <button
          className="btn primary"
          disabled={!behaviour.trim()}
          onClick={async () => {
            await db.transferObs.add({ date: new Date().toISOString(), seenOn, areaId, behaviour: behaviour.trim(), author });
            await logHistory(author, 'transfer observation', `${areaName(p, areaId)} ${seenOn}: ${behaviour.trim()}`);
            await recordMilestones(p);
            setBehaviour('');
          }}
        >
          Save observation
        </button>
      </div>
      <div className="card">
        <ul className="clean">
          {[...transfers]
            .sort((a, b) => b.seenOn.localeCompare(a.seenOn))
            .map((t) => (
              <li key={t.id}>
                {t.seenOn} · {areaName(p, t.areaId)} · {t.author}: {t.behaviour}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

export function HistorySection() {
  const { history, overrides, programme: p } = useData();
  return (
    <div className="stack">
      <div className="card">
        <h2>Content overrides</h2>
        <table className="data">
          <tbody>
            {[...overrides]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((o) => (
                <tr key={o.id} className={o.revertedAt ? 'greyed' : ''}>
                  <td className="mono">{fmtDate(o.date)}</td>
                  <td>
                    {o.target.kind} {o.target.kind === 'drill' ? `${o.target.id} ${p.drills.find((d) => d.id === o.target.id)?.name ?? ''}` : o.target.id} · {o.field}
                    <br />
                    <span className="muted">was: {JSON.stringify(o.previousValue)?.slice(0, 160)}</span>
                    <br />
                    now: {JSON.stringify(o.value)?.slice(0, 160)}
                  </td>
                  <td>{o.author}</td>
                  <td>
                    {o.revertedAt ? (
                      `reverted ${fmtDate(o.revertedAt)}`
                    ) : (
                      <button
                        className="btn small"
                        onClick={async () => {
                          await db.overrides.update(o.id!, { revertedAt: new Date().toISOString() });
                          await logHistory('parent', 'revert', `${o.target.kind} ${o.target.id} ${o.field}`);
                        }}
                      >
                        Revert
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>All changes</h2>
        <ul className="clean">
          {[...history]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((h) => (
              <li key={h.id}>
                {fmtDate(h.date, { day: 'numeric', month: 'short', year: 'numeric' })} · {h.author} · {h.action}: {h.detail}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
