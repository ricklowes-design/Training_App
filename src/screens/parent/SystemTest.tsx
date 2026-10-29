import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { logHistory, useData } from '../../app/data';
import { useNav } from '../../app/nav';
import type { RepAnalysis } from '../../analysis/types';
import { currentSetup } from '../../camera/clips';
import { sampleFootage } from '../../camera/footage';
import { familyOf } from '../../camera/session';
import { db } from '../../db/db';
import type { FeatureFlags, SessionRecord, Settings } from '../../db/types';
import { CHECK_LABELS, coneMoves, evaluateBlock, systemTestPlan, TEST_FLAGS, type BlockEvidence, type CheckOutcome, type CheckResult, type FootageStats } from '../../domain/systemTest';
import { fmtDate } from '../../ui/widgets';

// Parent → System test (parent request 2026-10-29): every feature switched on, the drills grouped
// by cone layout, then a report per block with the likely reasons when something did not work.

const PILL: Record<CheckResult, { cls: string; text: string }> = {
  pass: { cls: 'go', text: 'Worked' },
  partial: { cls: 'info', text: 'Partly' },
  fail: { cls: 'warn', text: 'Did not work' },
  notRun: { cls: '', text: 'Not run' },
  pending: { cls: '', text: 'Checking…' },
};

export function SystemTestSection({ runId }: { runId?: string }) {
  return runId ? <Report runId={runId} /> : <Intro />;
}

function Intro() {
  const d = useData();
  const { programme: p, settings, cameraSetups, records } = d;
  const { go } = useNav();
  const st = p.systemTest;
  const plan = systemTestPlan(p);
  const balls = useLiveQuery(() => db.ballProfiles.toArray(), []);
  if (!st || !plan) return <p className="muted">This programme file has no system test.</p>;
  const layouts = [...new Set(st.blocks.map((b) => b.layoutId))];
  const past = records.filter((r) => r.kind === 'systemTest').sort((a, b) => b.date.localeCompare(a.date));
  const restore = settings.systemTestRestore;

  const ready: { ok: boolean; text: string; fix?: () => void; fixText?: string }[] = [
    ...layouts.map((l) => {
      const s = currentSetup(cameraSetups, familyOf(l));
      return { ok: !!s, text: `Camera set-up for ${p.layouts[l]?.name ?? l}${s && !s.tripwire ? ' (no tripwire line drawn)' : ''}`, fix: () => go({ name: 'parent', section: 'camera' }), fixText: 'Camera set-up' };
    }),
    { ok: !!balls?.length, text: 'A ball registered for ball tracking', fix: () => go({ name: 'parent', section: 'balls' }), fixText: 'Balls' },
    { ok: !!d.roomProfile?.wallUsable, text: 'Back wall marked usable in the room profile (for the wall-bang cues)', fix: () => go({ name: 'parent', section: 'room' }), fixText: 'Room profiles' },
    { ok: settings.camera.pose !== 'off', text: 'Pose speed test run (body tracking on)', fix: () => go({ name: 'parent', section: 'posetest' }), fixText: 'Pose speed test' },
    { ok: settings.capabilities?.defenderFps !== undefined, text: '3D defender test run on this Chromebook', fix: () => go({ name: 'parent', section: 'defender' }), fixText: '3D defender test' },
  ];

  async function start() {
    if (!plan) return;
    await switchOnForTest(settings);
    go({ name: 'run', plan, trial: true, trialReasons: ['system test'] });
  }

  return (
    <div className="stack" data-testid="system-test">
      <div className="card stack">
        <h3 style={{ margin: 0 }}>{st.title}</h3>
        {st.note ? <p className="muted">{st.note}</p> : null}
        <p>
          About {plan.totalMinutes} minutes, {plan.blocks.length} drills. The cones are set up {layouts.length} times ({coneMoves(p)} moves); each drill shows its cones when it starts. Afterwards the report says which features worked and,
          where one did not, the likely reasons from the recording.
        </p>
        {layouts.map((l) => (
          <div key={l}>
            <strong>{p.layouts[l]?.name ?? l} cones</strong>
            <ul className="clean">
              {st.blocks
                .filter((b) => b.layoutId === l)
                .map((b) => (
                  <li key={b.drillId}>
                    {p.drills.find((x) => x.id === b.drillId)?.name ?? b.drillId} ({b.minutes} min): <span className="muted">{b.tests}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="card stack" data-testid="system-test-ready">
        <h3 style={{ margin: 0 }}>Before you start</h3>
        <p className="muted">The test runs without these, but the features that need them will show as not working.</p>
        <ul className="clean">
          {ready.map((r) => (
            <li key={r.text} className="row">
              <span className={`pill ${r.ok ? 'go' : 'warn'}`}>{r.ok ? 'Ready' : 'Missing'}</span> {r.text}
              {!r.ok && r.fix ? (
                <button className="btn small" onClick={r.fix}>
                  {r.fixText}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="muted">
          Starting switches on: recording, the 3D defender (realistic motion), the live feint detector, ball tracking, rapid touches, personalisation, cone and ball detectors, the voice, tones and the wall
          microphone. Session messages stay as they are. The test never counts toward the week, never unlocks anything and is not used for learning.
        </p>
        <TurnOnTestButton />
        <div className="row">
          <button className="btn primary" onClick={start} data-testid="system-test-start">
            Switch everything on and start the test
          </button>
          {restore ? <RestoreButton /> : null}
        </div>
      </div>
      {past.length ? (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Earlier tests</h3>
          <ul className="clean">
            {past.map((r) => (
              <li key={r.id}>
                <button className="btn small" onClick={() => go({ name: 'parent', section: 'systest', arg: r.runId })}>
                  {fmtDate(r.date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}: report
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Everything the test uses, switched on; the settings before are kept for "Put the settings back". */
async function switchOnForTest(s: Settings) {
  const on = Object.fromEntries(TEST_FLAGS.map((f) => [f, true])) as Partial<FeatureFlags>;
  await db.settings.update('main', {
    // Keep the first snapshot if a test was left switched on.
    systemTestRestore: s.systemTestRestore ?? { savedAt: new Date().toISOString(), flags: s.flags, cueEngine: s.cueEngine, cameraEnabled: s.camera.enabled, wallMic: s.sound.wallMic, speech: s.sound.speech, tones: s.sound.tones },
    flags: { ...s.flags, ...on },
    cueEngine: true,
    camera: { ...s.camera, enabled: true },
    sound: { ...s.sound, wallMic: true, speech: true, tones: true },
  });
  await logHistory('parent', 'system test', 'everything switched on for the system test');
}

const FLAG_LABELS: Record<string, string> = {
  defender3d: 'the 3D defender',
  realisticDefender: 'realistic defender motion',
  liveOnsetDetector: 'the feint detector',
  ballTracking: 'ball tracking',
  rapidTouches: 'rapid touches',
  learning: 'personalisation',
  coneDetection: 'the cone detector',
  neuralBallDetector: 'the ball detector model',
};

/** The switches the test uses that are off right now. */
export function testSwitchesOff(s: Settings): string[] {
  return [
    ...(!s.camera.enabled ? ['camera recording'] : []),
    ...(!s.cueEngine ? ['cues on the screen'] : []),
    ...TEST_FLAGS.filter((f) => !s.flags[f]).map((f) => FLAG_LABELS[f] ?? f),
    ...(s.sound.wallMic === false ? ['listening for the wall'] : []),
    ...(!s.sound.speech ? ['the voice'] : []),
    ...(!s.sound.tones ? ['the tones'] : []),
  ];
}

/** "Turn on what's off": everything the test uses, without starting it. */
function TurnOnTestButton() {
  const { settings } = useData();
  const off = testSwitchesOff(settings);
  if (!off.length) return <span className="pill go" data-testid="system-test-all-on">Everything the test uses is on</span>;
  return (
    <div className="note-box stack" data-testid="system-test-off">
      <span>Off now: {off.join(', ')}.</span>
      <div className="row">
        <button className="btn" onClick={() => switchOnForTest(settings)} data-testid="system-test-turn-on">
          Turn on everything the test uses
        </button>
      </div>
    </div>
  );
}

function RestoreButton() {
  const { settings } = useData();
  const r = settings.systemTestRestore;
  if (!r) return null;
  async function restore() {
    await db.settings.update('main', {
      flags: r!.flags,
      cueEngine: r!.cueEngine,
      camera: { ...settings.camera, enabled: r!.cameraEnabled },
      sound: { ...settings.sound, wallMic: r!.wallMic, speech: r!.speech, tones: r!.tones },
      systemTestRestore: undefined,
    });
    await logHistory('parent', 'system test', 'settings put back as they were before the system test');
  }
  return (
    <button className="btn" onClick={restore} data-testid="system-test-restore">
      Put the settings back as they were before the test
    </button>
  );
}

interface BlockData {
  ev: BlockEvidence;
  clipBlob?: Blob;
  clipId?: string;
}

function Report({ runId }: { runId: string }) {
  const d = useData();
  const { programme: p, settings, cameraSetups } = d;
  const { go } = useNav();
  const st = p.systemTest;
  const rec = d.records.find((r) => r.runId === runId && r.kind === 'systemTest');
  const [footage, setFootage] = useState<Record<string, FootageStats | null>>({});
  const loaded = useLiveQuery(async () => {
    if (!rec) return null;
    const clips = await db.clips.where('sessionRecordId').equals(rec.id).toArray();
    const analyses = await db.blockAnalyses.where('clipId').anyOf(clips.map((c) => c.id)).toArray();
    const reps = await db.repAnalyses.where('clipId').anyOf(clips.map((c) => c.id)).toArray();
    const scenarios = await db.defenderScenarios.filter((x) => x.sessionRecordId === rec.id).toArray();
    const balls = await db.ballProfiles.toArray();
    return { clips, analyses, reps, scenarios, balls };
  }, [rec?.id, rec?.blocks.length]);

  // Footage statistics, one clip at a time.
  useEffect(() => {
    const todo = loaded?.clips.find((c) => !(c.id in footage));
    if (!todo) return;
    let stop = false;
    void sampleFootage(todo.blob).then((f) => !stop && setFootage((x) => ({ ...x, [todo.id]: f ?? null })));
    return () => {
      stop = true;
    };
  }, [loaded, footage]);

  if (!rec || !st) return <p className="muted">This test was not found.</p>;
  if (!loaded) return <p className="muted">Loading…</p>;
  const ball = loaded.balls.find((b) => b.id === settings.activeBallProfileId) ?? loaded.balls[0];
  // Settings as the test ran them (switched on), or now if they were put back.
  const flags = settings.systemTestRestore ? settings.flags : { ...settings.flags, ...Object.fromEntries(TEST_FLAGS.map((f) => [f, true])) };

  const blocks: (BlockData & { title: string; tests: string; checks: string[]; layoutId: string })[] = st.blocks.map((sb, i) => {
    // The last real (not practice) attempt of this block.
    const results = rec.blocks.filter((b) => b.index === i && !b.practice);
    const block = results[results.length - 1];
    const clip = block?.clipId ? loaded.clips.find((c) => c.id === block.clipId) : undefined;
    const analysis = clip ? loaded.analyses.find((a) => a.clipId === clip.id)?.data : undefined;
    const reps = clip ? loaded.reps.filter((r) => r.clipId === clip.id).map((r) => r.data as RepAnalysis) : [];
    const setup = currentSetup(cameraSetups, familyOf(sb.layoutId));
    const ev: BlockEvidence = {
      block,
      hasClip: !!clip,
      footage: clip ? footage[clip.id] ?? undefined : undefined,
      analysis,
      analysisExpected: !!clip?.cameraSetupId,
      reps,
      scenarios: loaded.scenarios.filter((x) => x.blockIndex === i && (block === undefined || x.attempt === undefined || x.attempt === block.attempt)),
      ctx: {
        cameraOn: settings.camera.enabled,
        setup: !!setup,
        setupTripwire: !!setup?.tripwire?.length,
        setupGates: (setup?.zones.length ?? 0) > 1,
        setupSquare: !!setup?.zones[0],
        pose: settings.camera.pose,
        analysisFps: settings.camera.analysisFps,
        flags,
        webgl: settings.capabilities?.webgl,
        defenderFps: settings.capabilities?.defenderFps,
        ballProfile: !!ball,
        ballBackgroundShare: ball?.backgroundMatchShare,
        wallUsable: !!d.roomProfile?.wallUsable,
        wallMic: settings.sound.wallMic !== false,
        roomCheck: rec.roomCheck?.status,
      },
    };
    return { ev, clipBlob: clip?.blob, clipId: clip?.id, title: p.drills.find((x) => x.id === sb.drillId)?.name ?? sb.drillId, tests: sb.tests, checks: sb.checks, layoutId: sb.layoutId };
  });
  const all = blocks.flatMap((b) => evaluateBlock(b.checks, b.ev));
  const count = (r: CheckResult) => all.filter((x) => x.result === r).length;

  return (
    <div className="stack" data-testid="system-test-report">
      <div className="card stack">
        <h3 style={{ margin: 0 }}>System test, {fmtDate(rec.date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</h3>
        <p data-testid="system-test-totals">
          {count('pass')} worked · {count('partial')} partly · {count('fail')} did not work · {count('notRun')} not run{count('pending') ? ` · ${count('pending')} still checking` : ''}
        </p>
        <p className="muted">Reasons are the likely causes from the block's results and a look at its recording (brightness, blur, movement); check them against the clip.</p>
        <div className="row">
          <button className="btn" onClick={() => go({ name: 'parent', section: 'systest' })}>
            Back to the system test
          </button>
          <RestoreButton />
        </div>
        {count('fail') || count('partial') ? <TurnOnTestButton /> : null}
      </div>
      {blocks.map((b, i) => (
        <BlockReport key={i} n={i + 1} b={b} outcomes={evaluateBlock(b.checks, b.ev)} layoutName={p.layouts[b.layoutId]?.name ?? b.layoutId} />
      ))}
      <ParentChecks rec={rec} />
    </div>
  );
}

function BlockReport({ n, b, outcomes, layoutName }: { n: number; b: BlockData & { title: string; tests: string }; outcomes: CheckOutcome[]; layoutName: string }) {
  const [url, setUrl] = useState<string>();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!show || !b.clipBlob) return;
    const u = URL.createObjectURL(b.clipBlob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [show, b.clipBlob]);
  const f = b.ev.footage;
  return (
    <div className="card stack" data-testid="system-test-block">
      <h3 style={{ margin: 0 }}>
        {n}. {b.title} <span className="muted">({layoutName} cones)</span>
      </h3>
      <p className="muted">{b.tests}</p>
      <table className="data" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '32%' }} />
          <col style={{ width: 120 }} />
          <col />
        </colgroup>
        <tbody>
          {outcomes.map((o) => (
            <tr key={o.id}>
              <td>{CHECK_LABELS[o.id]}</td>
              <td>
                <span className={`pill ${PILL[o.result].cls}`}>{PILL[o.result].text}</span>
              </td>
              <td>
                {o.detail}
                {o.reasons.length ? (
                  <ul className="muted" style={{ margin: '4px 0 0' }}>
                    {o.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {f ? (
        <p className="muted">
          Recording: brightness {f.meanLuma}/255, sharpness {f.sharpness}, movement {f.motion} ({f.frames} frames sampled).
        </p>
      ) : null}
      {b.clipBlob ? (
        show && url ? (
          <video src={url} controls muted playsInline style={{ maxWidth: '100%', maxHeight: '40vh', borderRadius: 12 }} />
        ) : (
          <button className="btn small" onClick={() => setShow(true)}>
            Watch the recording
          </button>
        )
      ) : null}
    </div>
  );
}

function ParentChecks({ rec }: { rec: SessionRecord }) {
  const { programme: p } = useData();
  const qs = p.systemTest?.parentChecks ?? [];
  if (!qs.length) return null;
  async function answer(id: string, v: boolean) {
    await db.sessionRecords.update(rec.id, { parentChecks: { ...rec.parentChecks, [id]: v } });
  }
  return (
    <div className="card stack" data-testid="system-test-parent-checks">
      <h3 style={{ margin: 0 }}>Your checks</h3>
      <p className="muted">Things only a person can judge.</p>
      {qs.map((q) => {
        const v = rec.parentChecks?.[q.id];
        return (
          <div key={q.id} className="row spread">
            <span>{q.question}</span>
            <span className="row">
              <button className={`btn small${v === true ? ' primary' : ''}`} onClick={() => answer(q.id, true)}>
                Yes
              </button>
              <button className={`btn small${v === false ? ' primary' : ''}`} onClick={() => answer(q.id, false)}>
                No
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
