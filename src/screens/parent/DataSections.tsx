import { useRef, useState } from 'react';
import { APP_VERSION, logHistory, useData } from '../../app/data';
import { useNav } from '../../app/nav';
import { backupFileName, exportBackup, importBackup } from '../../db/backup';
import { db } from '../../db/db';
import type { SessionRecord } from '../../db/types';
import { resultText } from '../../domain/metrics';
import { recordMilestones } from '../../domain/milestoneStore';
import { areaName } from '../../domain/plans';
import { countedResults } from '../../domain/records';
import { canDemote, demote, promote } from '../../domain/trial';
import { DemoVideo, fmtTime, linkStart, parseTime, youtubeId } from '../../runner/DemoVideo';
import type { Drill } from '../../content/types';
import { DrillAnimation } from '../../ui/DrillAnimation';
import { scriptFor } from '../../ui/drillScripts';
import { downloadText, fmtDate, Modal, StatusPill } from '../../ui/widgets';
import { ruleStatusFor, useAreaProgress } from '../helpers';

export function BackupSection() {
  const { settings, records, problemReports } = useData();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  async function doExport() {
    const b = await exportBackup(db, APP_VERSION);
    downloadText(backupFileName(), JSON.stringify(b, null, 1));
    await db.settings.update('main', { lastBackupAt: new Date().toISOString() });
    setMsg(`Backup saved to Downloads (${records.length} sessions). Move it to Google Drive to keep it off this Chromebook.`);
  }

  async function doImport(text: string) {
    const r = await importBackup(db, text);
    setPending(null);
    if (!r.ok) setMsg(r.error);
    else setMsg(`Restored: ${r.counts.sessionRecords ?? 0} sessions, ${r.counts.benchmarkResults ?? 0} results, ${r.counts.coachNotes ?? 0} notes.`);
  }

  return (
    <div className="stack">
      <div className="card stack">
        <p>
          Everything is stored only in Chrome on this Chromebook. A backup is one file with every session, result, note, override and setting. Own demo clips are not included; they stay on
          this device.
        </p>
        <p className="muted">
          Last backup: {settings.lastBackupAt ? fmtDate(settings.lastBackupAt, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never'} · Chrome keeps this site's data:{' '}
          {settings.persistGranted ? 'yes (persistent storage granted)' : 'not guaranteed (Chrome may clear it when space is short)'} · Problem reports: {problemReports.length}
        </p>
        <div className="row">
          <button className="btn primary" onClick={doExport}>
            Export backup
          </button>
          <button className="btn" onClick={() => file.current?.click()}>
            Import backup…
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setPending(await f.text());
              e.target.value = '';
            }}
          />
        </div>
        {msg ? <div className="note-box">{msg}</div> : null}
      </div>
      {pending !== null ? (
        <Modal onClose={() => setPending(null)}>
          <h2>Replace everything with the backup?</h2>
          <p>All sessions, results, notes and settings on this Chromebook are replaced by the file's contents. Own demo clips are kept.</p>
          <div className="row spread">
            <button className="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => doImport(pending)}>
              Replace with backup
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function ContentSection() {
  const { programme: p, base, overrides, customDrills } = useData();
  const { go } = useNav();
  return (
    <div className="stack">
      <div className="card">
        <p>
          Content file <code>content/programme.json</code> version <strong>{base.version}</strong> ({base.generated}) loaded and valid: {base.drills.length} drills, {base.sessions.length} sessions,{' '}
          {base.benchmarks.length} benchmarks, {base.anchors.length} anchors. Coach overrides active: {overrides.filter((o) => !o.revertedAt).length}; custom drills: {customDrills.length}.
        </p>
        <p className="muted">{base.note}</p>
      </div>
      {p.areas.map((a) => (
        <div key={a.id} className="card">
          <h3>{a.name}</h3>
          <table className="data">
            <tbody>
              {p.drills
                .filter((d) => d.areaId === a.id)
                .map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.id}</td>
                    <td>
                      <strong>{d.name}</strong> <span className="muted">· {d.layoutId} · {d.mode}</span>
                      <br />
                      {d.prescription}
                    </td>
                    <td>
                      <button className="btn small" onClick={() => go({ name: 'parent', section: 'drills', arg: d.id })}>
                        Adjust
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export { RoomProfilesSection as RoomSection } from './RoomProfiles';

export function TrialsSection() {
  const d = useData();
  const { records, settings, problemReports, programme: p } = d;
  const [demoting, setDemoting] = useState<SessionRecord | null>(null);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState(settings.trialUntil ?? '');
  const now = new Date();
  const trials = records.filter((r) => r.trial && !r.promotedAt && r.kind !== 'systemTest').sort((a, b) => b.date.localeCompare(a.date));
  const recent = records.filter((r) => canDemote(r, now).ok).sort((a, b) => b.date.localeCompare(a.date));
  const label = (r: SessionRecord) => `${fmtDate(r.date)} · ${r.areaId ? `${areaName(p, r.areaId)} S${r.sessionNumber ?? ''}` : r.kind}${r.kind === 'baseline' ? ' baseline' : ''}`;

  return (
    <div className="stack">
      <div className="card stack">
        <h2>Trial period</h2>
        <p className="muted">All sessions are trials until this date (for example the first two weeks after install or after a big update). Leave empty for none.</p>
        <div className="row">
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={{ maxWidth: 220 }} />
          <button
            className="btn"
            onClick={async () => {
              await db.settings.update('main', { trialUntil: until || undefined });
              await logHistory('parent', 'trial period', until ? `Trials until ${until}` : 'Trial period cleared');
            }}
          >
            Save
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Trials (not counted)</h2>
        {trials.length === 0 ? <p className="muted">None.</p> : null}
        <ul className="clean">
          {trials.map((r) => (
            <li key={r.id} className="row spread">
              <span>
                {label(r)} <StatusPill status={r.status} />
              </span>
              <button
                className="btn small primary"
                onClick={async () => {
                  await db.sessionRecords.put(promote(r, new Date()));
                  await logHistory('parent', 'keep trial', label(r));
                  await recordMilestones(p);
                }}
              >
                Keep this
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h2>Make a recorded session a trial (last 7 days)</h2>
        <p className="muted">Use this when a bug affected a session. The unlock is reversed only when no later session depends on it. Logged with the reason.</p>
        <ul className="clean">
          {recent.map((r) => (
            <li key={r.id} className="row spread">
              <span>
                {label(r)} <StatusPill status={r.status} />
              </span>
              <button className="btn small" onClick={() => setDemoting(r)}>
                Make this a trial
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h2>Problem reports</h2>
        {problemReports.length === 0 ? <p className="muted">None.</p> : null}
        <ul className="clean">
          {problemReports.map((r) => (
            <li key={r.id}>
              {fmtDate(r.date)} · app {r.appVersion} · content {r.contentVersion}: {r.note}
            </li>
          ))}
        </ul>
      </div>
      {demoting ? (
        <Modal onClose={() => setDemoting(null)}>
          <h2>Make this a trial</h2>
          <p>{label(demoting)}</p>
          <label className="field">
            <span>Reason (required)</span>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </label>
          <div className="row spread" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setDemoting(null)}>
              Cancel
            </button>
            <button
              className="btn danger"
              disabled={!reason.trim()}
              onClick={async () => {
                const updated = demote(demoting, records, reason.trim(), new Date());
                await db.sessionRecords.put(updated);
                await logHistory('parent', 'make trial', `${label(demoting)}: ${reason.trim()}${updated.unlockRetained ? ' (unlock kept: a later session depends on it)' : ''}`);
                setDemoting(null);
                setReason('');
              }}
            >
              Make this a trial
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function PlacementSection() {
  const d = useData();
  const { programme: p, placements, records } = d;
  const { go } = useNav();
  const progress = useAreaProgress();
  const [area, setArea] = useState<string | null>(null);
  const [n, setN] = useState(1);
  const [why, setWhy] = useState('');
  return (
    <div className="stack">
      {p.areas.map((a) => {
        const pl = placements.find((x) => x.areaId === a.id);
        const pr = progress.find((x) => x.areaId === a.id);
        const baseline = records.filter((r) => r.areaId === a.id && r.kind === 'baseline' && r.status !== 'stopped').sort((x, y) => y.date.localeCompare(x.date))[0];
        return (
          <div key={a.id} className="card stack">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>{a.name}</h3>
              <span>{pl ? `Started at Session ${pl.startSession}${pl.overridden ? ` (override; proposed ${pl.proposed})` : ''} · next ${pr?.next ?? 'done'}` : 'Not placed'}</span>
            </div>
            {pl?.explanation ? <p className="muted">{pl.explanation}</p> : null}
            <div className="row">
              {!pl && baseline ? (
                <button className="btn primary" onClick={() => go({ name: 'baselineQuestions', recordId: baseline.id })}>
                  Answer the baseline questions
                </button>
              ) : null}
              <button
                className="btn"
                onClick={() => {
                  setArea(a.id);
                  setN(pl?.startSession ?? p.baselines.find((b) => b.areaId === a.id)?.defaultStartSession ?? 1);
                }}
              >
                {pl ? 'Change placement' : 'Place without a baseline'}
              </button>
            </div>
          </div>
        );
      })}
      {area ? (
        <Modal onClose={() => setArea(null)}>
          <h2>{areaName(p, area)} placement</h2>
          <label className="field">
            <span>Start at session</span>
            <select value={n} onChange={(e) => setN(Number(e.target.value))}>
              {p.sessions
                .filter((s) => s.areaId === area)
                .map((s) => (
                  <option key={s.number} value={s.number}>
                    Session {s.number} (Stage {p.stages.find((x) => x.id === s.stageId)?.order})
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>Reason (logged)</span>
            <input type="text" value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          <div className="row spread" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setArea(null)}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!why.trim()}
              onClick={async () => {
                const prev = placements.find((x) => x.areaId === area);
                await db.placements.put({
                  areaId: area,
                  startSession: n,
                  proposed: prev?.proposed ?? n,
                  overridden: true,
                  explanation: `Set by parent: ${why.trim()}`,
                  date: new Date().toISOString(),
                  baselineRecordId: prev?.baselineRecordId,
                });
                await logHistory('parent', 'placement override', `${areaName(p, area)}: Session ${n} (${why.trim()})`);
                setArea(null);
                setWhy('');
              }}
            >
              Save
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function DemosSection() {
  const { programme: p, demoClipIds } = useData();
  const [msg, setMsg] = useState('');
  return (
    <div className="stack">
      <p className="muted">
        Own clips: 15–30 s, landscape, filmed by a parent with the coach's nod (plan/03 §3.10). They loop in the demo view and always take priority over a link. The suggested YouTube links were
        chosen from their titles and descriptions and have not been watched: press Preview, check the video shows the move, and set the start and end so only the useful part plays (it loops).
      </p>
      {msg ? <div className="note-box">{msg}</div> : null}
      {p.drills.map((d) => (
        <DemoCard key={d.id} d={d} hasClip={demoClipIds.includes(d.id)} onMsg={setMsg} />
      ))}
    </div>
  );
}

async function saveDemo(d: Drill, value: Partial<Drill['demo']>, what: string) {
  await db.overrides.add({
    date: new Date().toISOString(),
    author: 'parent',
    target: { kind: 'drill', id: d.id },
    field: 'demo',
    value,
    previousValue: { type: d.demo.type, ref: d.demo.ref, title: d.demo.title, startS: d.demo.startS, endS: d.demo.endS },
  });
  await logHistory('parent', 'demo', `${d.id}: ${what}`);
}

function DemoCard({ d, hasClip, onMsg }: { d: Drill; hasClip: boolean; onMsg: (m: string) => void }) {
  const { layout, settings } = useData();
  const anim = !!layout && !!scriptFor(d.id, layout.derived, layout.roomLengthM);
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState(false);
  const [start, setStart] = useState(d.demo.startS !== undefined ? fmtTime(d.demo.startS) : '');
  const [end, setEnd] = useState(d.demo.endS !== undefined ? fmtTime(d.demo.endS) : '');
  const isLink = d.demo.type === 'youtube' && !!d.demo.ref;
  const startS = parseTime(start);
  const endS = parseTime(end);
  const timesBad = (start.trim() && startS === null) || (end.trim() && endS === null) || (startS !== null && endS !== null && endS <= startS);
  return (
    <div className="card tight stack" data-testid={`demo-${d.id}`}>
      <div className="row spread">
        <span style={{ flex: 1 }}>
          <strong>
            {d.id} · {d.name}
          </strong>
          <br />
          <span className="muted">
            {hasClip ? 'Own clip stored (used instead of any link)' : isLink ? `${d.demo.title ? `“${d.demo.title}”` : 'Link'}${d.demo.startS !== undefined || d.demo.endS !== undefined ? ` · ${fmtTime(d.demo.startS ?? 0)}–${d.demo.endS !== undefined ? fmtTime(d.demo.endS) : 'end'}` : ' · whole video'}` : 'No demonstration yet'} · {d.demo.status}
          </span>
        </span>
        {isLink || hasClip ? (
          <button className="btn small" onClick={() => setPreview(!preview)}>
            {preview ? 'Close preview' : 'Preview'}
          </button>
        ) : null}
        <label className="btn small">
          {hasClip ? 'Replace clip' : 'Add own clip'}
          <input
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              await db.demoClips.put({ drillId: d.id, blob: f, mime: f.type, date: new Date().toISOString() });
              await logHistory('parent', 'demo clip', `${d.id}: own clip stored (${Math.round(f.size / 1e5) / 10} MB)`);
              onMsg(`${d.id}: clip stored.`);
              e.target.value = '';
            }}
          />
        </label>
        {hasClip ? (
          <button
            className="btn small"
            onClick={async () => {
              await db.demoClips.delete(d.id);
              await logHistory('parent', 'demo clip', `${d.id}: own clip removed`);
            }}
          >
            Remove clip
          </button>
        ) : null}
      </div>
      {preview ? (
        <div style={{ maxWidth: 560 }}>
          <DemoVideo drill={d} hasOwnClip={hasClip} />
        </div>
      ) : null}
      {anim && layout ? (
        <details>
          <summary>Animated drill (the app's own combination: where to go and what each cue asks)</summary>
          <div style={{ maxWidth: 420 }}>
            <DrillAnimation drillId={d.id} d={layout.derived} lengthM={layout.roomLengthM} widthM={layout.roomWidthM} floor={layout.floor} units={settings.units} />
          </div>
        </details>
      ) : null}
      {isLink && !hasClip ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="muted">Show only</span>
          <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="start m:ss" aria-label={`${d.id} start`} style={{ width: 100 }} />
          <span className="muted">to</span>
          <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="end m:ss" aria-label={`${d.id} end`} style={{ width: 100 }} />
          <button
            className="btn small"
            disabled={!!timesBad}
            onClick={async () => {
              await saveDemo(d, { startS: startS ?? undefined, endS: endS ?? undefined }, startS === null && endS === null ? 'whole video' : `part ${fmtTime(startS ?? 0)}–${endS !== null ? fmtTime(endS) : 'end'}`);
              onMsg(`${d.id}: ${startS === null && endS === null ? 'the whole video will play' : 'only that part will play, on a loop'}.`);
            }}
          >
            Save part
          </button>
          {timesBad ? <span className="muted">Use m:ss, with the end after the start.</span> : null}
        </div>
      ) : null}
      {d.demo.alternatives?.length && !hasClip ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="muted">Other suggestions:</span>
          {d.demo.alternatives
            .filter((a) => a.ref !== d.demo.ref)
            .map((a) => (
              <button
                key={a.ref}
                className="btn small"
                onClick={async () => {
                  await saveDemo(d, { type: 'youtube', ref: a.ref, title: a.title, startS: a.startS, endS: a.endS }, `switched to “${a.title}”`);
                  setStart(a.startS !== undefined ? fmtTime(a.startS) : '');
                  setEnd(a.endS !== undefined ? fmtTime(a.endS) : '');
                  onMsg(`${d.id}: now using “${a.title}”. Preview it to check.`);
                }}
              >
                Use “{a.title}”
              </button>
            ))}
        </div>
      ) : null}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input type="url" placeholder="Paste a YouTube link (a ?t= time sets the start)" value={link} onChange={(e) => setLink(e.target.value)} style={{ flex: 1, minWidth: 240 }} aria-label={`${d.id} link`} />
        <button
          className="btn small"
          disabled={!youtubeId(link)}
          onClick={async () => {
            const s = linkStart(link);
            await saveDemo(d, { type: 'youtube', ref: link.trim(), title: 'Your link', startS: s, endS: undefined }, 'own link saved');
            setLink('');
            setStart(s !== undefined ? fmtTime(s) : '');
            setEnd('');
            onMsg(`${d.id}: link saved. Preview it, then set where it should stop.`);
          }}
        >
          Save link
        </button>
      </div>
    </div>
  );
}

const UNRELIABLE_REASONS = ['start tone missed', 'timed by hand', 'interrupted', 'wrong set-up', 'counted after the fact'];

/** A parent marks a benchmark result unreliable (plan/05 §5.6): it stays in the history, labelled, and joins no comparison or advancement. */
export function ResultsSection() {
  const { programme: p, results } = useData();
  const [reason, setReason] = useState<Record<string, string>>({});
  const rows = [...results].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  const name = (id?: string) => p.benchmarks.find((b) => b.id === id)?.name ?? p.anchors.find((a) => a.id === id)?.name ?? id ?? '';
  return (
    <div className="stack">
      <p className="muted">The 40 most recent results. A result marked unreliable stays in the history with its reason, but it is never compared with other results and never counts toward advancement.</p>
      {rows.length === 0 ? <p>No benchmark results yet.</p> : null}
      {rows.map((r) => (
        <div key={r.id} className="card tight row spread" data-testid={`result-${r.id}`} style={{ flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 240 }}>
            <strong>{name(r.benchmarkId)}</strong> · {fmtDate(r.date, { day: 'numeric', month: 'short' })}
            <br />
            <span className="mono">{resultText(r.values)}</span>
            <br />
            <span className="muted">
              {r.conditions.recordedBy}
              {r.flagged ? ` · unreliable: ${r.flagged}` : ''}
            </span>
          </span>
          {r.flagged ? (
            <button
              className="btn small"
              onClick={async () => {
                await db.benchmarkResults.update(r.id, { flagged: undefined });
                await logHistory('parent', 'result', `${name(r.benchmarkId)} ${r.date.slice(0, 10)}: unreliable flag cleared`);
              }}
            >
              Clear unreliable
            </button>
          ) : (
            <span className="row">
              <select aria-label={`Reason for ${r.id}`} value={reason[r.id] ?? UNRELIABLE_REASONS[0]} onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })}>
                {UNRELIABLE_REASONS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <button
                className="btn small"
                onClick={async () => {
                  const why = reason[r.id] ?? UNRELIABLE_REASONS[0];
                  await db.benchmarkResults.update(r.id, { flagged: why });
                  await logHistory('parent', 'result', `${name(r.benchmarkId)} ${r.date.slice(0, 10)}: marked unreliable (${why})`);
                }}
              >
                Mark unreliable
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** The coach export (plan/06 §6.3): area, stage, drill asked about, last two benchmarks with conditions, criteria and status. */
export function ExportSection() {
  const d = useData();
  const { programme: p, results, records } = d;
  const progress = useAreaProgress();
  const [area, setArea] = useState(p.areas[0].id);
  const [drill, setDrill] = useState('');
  const [question, setQuestion] = useState('');
  const pr = progress.find((x) => x.areaId === area);
  const stage = p.stages.find((s) => s.id === pr?.stageId);
  const bench = p.areas.find((a) => a.id === area)?.benchmarkId;
  const last2 = countedResults(results, records)
    .filter((r) => r.areaId === area && r.benchmarkId === bench)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 2);
  const status = ruleStatusFor(d, area);
  const drillObj = p.drills.find((x) => x.id === drill);
  const text = [
    `${p.areas.find((a) => a.id === area)?.name} — Stage ${stage?.order} (${stage?.name}), next session ${pr?.next ?? '—'}`,
    drillObj ? `Drill asked about: ${drillObj.id} ${drillObj.name} — ${drillObj.prescription}` : null,
    question ? `Question: ${question}` : null,
    'Last benchmark results:',
    ...(last2.length
      ? last2.map((r) => `  ${fmtDate(r.date, { day: 'numeric', month: 'short', year: 'numeric' })}: ${resultText(r.values)} (layout v${r.conditions.layoutVersion}, level ${r.conditions.cueLevel}, scored by ${r.conditions.recordedBy})`)
      : ['  none yet']),
    status ? `Next criteria: ${status.criteriaText} — ${status.qualifying} of ${status.needed}${status.met ? ' (met, awaiting confirmation)' : ''}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div className="stack">
      <div className="card stack">
        <div className="grid3">
          <label className="field">
            <span>Area</span>
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              {p.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Drill asked about (optional)</span>
            <select value={drill} onChange={(e) => setDrill(e.target.value)}>
              <option value="">—</option>
              {p.drills
                .filter((x) => x.areaId === area)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.id} {x.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>Question (optional)</span>
            <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </label>
        </div>
        <pre className="card tight" style={{ whiteSpace: 'pre-wrap' }}>
          {text}
        </pre>
        <div className="row">
          <button className="btn primary" onClick={() => navigator.clipboard?.writeText(text)}>
            Copy text
          </button>
          <button className="btn" onClick={() => downloadText(`coach-export-${area}.txt`, text, 'text/plain')}>
            Save as file
          </button>
        </div>
        <p className="muted">Nothing is sent from the app. Copy or save the text and send it yourself. Attach one own clip from the Chromebook's files if wanted.</p>
      </div>
    </div>
  );
}
