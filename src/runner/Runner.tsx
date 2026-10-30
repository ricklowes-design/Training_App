import { notifyFinished } from '../app/notify';
import { modelVersionLabel, personalisedThresholds } from '../learning/service';
import { useBlockAnalysis } from '../analysis/Scorecard';
import { cameraPrefill, PREFILL_KINDS, type PrefillKind } from '../analysis/prefill';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isOutputBusy, say, setSoundSettings, stopSpeech, tone, unlockAudio } from '../audio/audio';
import { listenForBangs } from '../audio/bang';
import { APP_VERSION, useData } from '../app/data';
import { useNav } from '../app/nav';
import { db } from '../db/db';
import type { BenchmarkResult, BenchmarkValues, Conditions } from '../db/types';
import { recordMilestones } from '../domain/milestoneStore';
import { countedResults } from '../domain/records';
import { capstoneGates } from '../domain/capstone';
import type { RunBlock, RunPlan } from '../domain/plans';
import { fmtClock, HoldButton } from '../ui/widgets';
import { BenchmarkForm, initialValues, type FormKind } from './BenchmarkForm';
import { DemoPanel } from './DemoPanel';
import { blockLayout, conesChanged } from './ConeSetup';
import { cueRuleLine } from './CueRules';
import { resolveTraining } from '../domain/trainingMode';
import { PracticeCard } from './PracticeCard';
import { cueDrillFor, usesWall } from '../cue/resolve';
import { EndCard } from './EndCard';
import * as E from './engine';
import { saveFailedText } from '../app/storage';
import { useWakeLock } from '../app/useWakeLock';
import { createRun, switchSnapshot, recordIdForBlock, saveBenchmark, saveProgress, saveRoomCheck, type RunIds } from './persist';
import { DigitFlasher, PictureQuiz, TimedRuns, VPullWindows } from './SpecialViews';
import { CueBlock } from './CueBlock';
import { cueConfigFor, engineCueLevel } from '../cue/resolve';
import type { CueConfig } from '../cue/engine';
import { useRunCamera, type BlockExtras } from './useRunCamera';
import { analyseClip } from '../analysis/run';
import { DefenderBlock } from '../defender/DefenderBlock';
import { defenderConfigFor } from '../defender/resolve';
import type { DefenderBlockConfig } from '../defender/block';
import { DefenderTally, DiagnosticCard } from './DefenderTally';
import { callOutsPerRep, DigitListener, scoreDigits, type Heard } from '../audio/speechDigits';
import { chancePct, chanceTail } from '../domain/chance';
import { tryFill } from '../domain/templates';
import { levelTag, reactionModeLevel } from '../defender/progression';
import { progressionEligible } from '../domain/focus';
import { useLiveQuery } from 'dexie-react-hooks';

const TIMED_RUN_KINDS = new Set(['DB', 'A1']);

/** Windows of a block's sets with a given label (e.g. C1's V-pull sets), on the block's active clock. */
function setWindowsFor(sets: { count: number; labels?: string[] } | undefined, minutes: number, label: string) {
  if (!sets?.labels || sets.count < 2) return undefined;
  const per = (minutes * 60_000) / sets.count;
  const out = sets.labels.map((l, i) => ({ l, i })).filter((x) => x.l === label).map(({ i }) => ({ label: `${label} (set ${i + 1})`, startMs: Math.round(i * per), endMs: Math.round((i + 1) * per) }));
  return out.length ? out : undefined;
}

export function Runner({ plan, trial }: { plan: RunPlan; trial: boolean }) {
  const data = useData();
  const { programme: p, settings, layout } = data;
  const { go } = useNav();
  const [s, setS] = useState<E.RunState>(() => E.initRun(plan, Date.now()));
  const [ids, setIds] = useState<RunIds | null>(null);
  // Parent → System test: never counts; its defender reps and tallies stay out of learning and progress.
  const systemTest = plan.parts[0]?.kind === 'systemTest';
  const [saved, setSaved] = useState<BenchmarkResult[]>([]);
  // Keyed by block and attempt: a Repeat runs its own timer and starts with an empty form (audit task 4).
  const [times, setTimes] = useState<Record<string, { right: number; left: number }>>({});
  const [digitsShown, setDigitsShown] = useState<Record<string, number[]>>({});
  const [skippedBench, setSkippedBench] = useState<Set<string>>(new Set());
  const [quizRounds, setQuizRounds] = useState<number[]>([]);
  const [now, setNow] = useState(Date.now());
  const finishing = useRef(false);
  const sRef = useRef(s);
  sRef.current = s;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  // Cue log, camera presence and clip per block attempt, merged into the block results when saving.
  const extras = useRef(new Map<string, BlockExtras>());
  const setExtras = useCallback((key: string, patch: BlockExtras) => extras.current.set(key, { ...extras.current.get(key), ...patch }), []);
  const withExtras = (st: E.RunState): E.RunState => ({
    ...st,
    results: st.results.map((r) => {
      const x = extras.current.get(`${r.index}:${r.attempt}`);
      return x ? { ...r, ...x } : r;
    }),
  });

  const block = E.currentBlock(s);
  const quizDrill = p.quiz.drillId;

  const blockName = useCallback(
    (b: RunBlock): string => {
      switch (b.kind) {
        case 'work':
          return p.drills.find((d) => d.id === b.drillId)?.name ?? (b.drillId === 'choice' ? 'Player’s choice' : b.drillId ?? 'Drill');
        case 'benchmark':
          return p.benchmarks.find((x) => x.id === b.benchmarkId)?.name ?? 'Benchmark';
        case 'anchor':
          return p.anchors.find((a) => a.id === b.anchorId)?.name ?? 'Anchor';
        case 'quiz':
          return 'Picture quiz';
        case 'warmup':
          return 'Warm-up';
        case 'rest':
          return 'Rest';
        case 'transition':
          return 'Transition: re-set the cones, water';
        case 'break':
          return 'Break: sit, water';
        case 'cooldown':
          return 'Cool-down: walking, calf and hip-flexor holds';
        case 'mobility':
          return 'Mobility';
        case 'log':
          return 'Cool down: two slow sole-roll laps';
      }
    },
    [p],
  );
  const setsFor = useCallback((b: RunBlock) => (b.drillId ? p.drills.find((d) => d.id === b.drillId)?.sets : undefined), [p]);
  const labels: E.Labels = useMemo(
    () => ({ blockName, warmupSteps: p.warmup.steps, countdownS: p.builder.countdownS, setsFor, startFor: (b: RunBlock) => {
        const id = blockLayout(p, b);
        return [id ? p.layouts[id]?.start : undefined, resolveTraining(p, b, settings, data.roomProfile?.wallUsable)?.say].filter(Boolean).join(' ') || undefined;
      } }),
    [blockName, p, setsFor, settings, data.roomProfile?.wallUsable],
  );
  const setWindows = (b: RunBlock, label: string) => setWindowsFor(setsFor(b), b.minutes, label);
  // Mastery-set windows the camera can measure: V-pull sets, and the tap sets for rapid-touch estimates.
  const controlWindows = (b: RunBlock) => {
    const w = ['V-pulls', 'Inside-outside taps', 'Outside-only taps'].flatMap((l) => setWindows(b, l) ?? []);
    return w.length ? w : undefined;
  };

  const benchmarksLogged = useMemo(() => new Set(saved.map((r) => r.blockIndex)), [saved]);
  const activeMs = useCallback(() => E.activeElapsedMs(sRef.current, Date.now()), []);

  // Wall drills: the cue comes when the ball hits the wall, heard through the microphone.
  const curBlock = s.plan.blocks[s.blockIdx];
  const wallSound = !!curBlock && settings.sound.wallMic !== false && usesWall(p, curBlock, data.roomProfile?.wallUsable);
  const bangAt = useRef<number | undefined>(undefined);
  const [mic, setMic] = useState<'off' | 'listening' | 'blocked'>('off');
  useEffect(() => {
    if (!wallSound || s.phase !== 'active') return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    bangAt.current = undefined;
    listenForBangs(() => (bangAt.current = activeMs()), isOutputBusy)
      .then((f) => {
        if (cancelled) f();
        else {
          stop = f;
          setMic('listening');
        }
      })
      .catch(() => setMic('blocked'));
    return () => {
      cancelled = true;
      stop?.();
      setMic('off');
    };
  }, [wallSound, s.phase, s.blockIdx, s.attempt, activeMs]);
  const idsRef = useRef<RunIds | null>(null);
  idsRef.current = ids;
  const camera = useRunCamera({
    programme: p,
    settings,
    setups: data.cameraSetups,
    state: s,
    stateRef: sRef,
    recordId: (i) => (idsRef.current ? recordIdForBlock(sRef.current.plan, idsRef.current, i) : null),
    activeMs,
    setExtras,
    onClip: (clip, b, setup) => {
      const key = `${clip.blockIndex}:${clip.attempt}`;
      const def = extras.current.get(key)?.defender;
      if (!def) return void analyseClip(p, clip, b, setup, extras.current.get(key)?.cueLog, undefined, extras.current.get(key)?.windows ?? controlWindows(b));
      void db.defenderScenarios
        .where('sessionRecordId')
        .equals(clip.sessionRecordId)
        .filter((x) => x.blockIndex === clip.blockIndex && (x.attempt ?? 1) === clip.attempt)
        .toArray()
        .then((scen) => analyseClip(p, clip, b, setup, undefined, scen));
    },
    roomProfile: data.roomProfile,
    onRoomCheck: (r) => {
      const save = () => (idsRef.current ? saveRoomCheck(idsRef.current, r ? { status: r.status, matched: r.matched, total: r.total } : { status: 'noPhoto', matched: 0, total: 0 }) : Promise.resolve());
      void (idsRef.current ? save() : setTimeout(save, 2000));
    },
  });
  // One cue configuration per block attempt (stable while the block runs).
  const cueCfgs = useRef(new Map<string, CueConfig | null>());
  const cueConfigFor_ = (b: RunBlock): CueConfig | null => {
    if (!settings.cueEngine) return null;
    // Each practice round gets its own (slow) configuration.
    const key = s.practice ? `${s.blockIdx}:p${s.results.length}` : `${s.blockIdx}:${s.attempt}`;
    if (!cueCfgs.current.has(key)) cueCfgs.current.set(key, cueConfigFor(p, b, { useTripwire: camera.tripwireAvailable, seed: Date.now(), practice: s.practice, sound: wallSound }));
    return cueCfgs.current.get(key) ?? null;
  };

  // One defender configuration per block attempt (part 15 D3); null when the block uses word/arrow cues.
  const defCfgs = useRef(new Map<string, DefenderBlockConfig | null>());
  const defenderConfigFor_ = (b: RunBlock): DefenderBlockConfig | null => {
    const key = `${s.blockIdx}:${s.attempt}`;
    if (!defCfgs.current.has(key)) defCfgs.current.set(key, defenderConfigFor(p, b, settings, Date.now(), modeLevel, tendency));
    return defCfgs.current.get(key) ?? null;
  };
  const [tallied, setTallied] = useState<Set<string>>(new Set());
  const cameraUsed = useRef(false);
  const learningState = useLiveQuery(async () => ({ versions: await db.modelVersions.toArray(), ls: await db.learningSettings.get('main') }), []);
  const personalModels = personalisedThresholds(learningState?.versions ?? [], learningState?.ls, !!settings.flags.learning).modelVersions;
  const [vPullsDone, setVPullsDone] = useState<Set<string>>(new Set());
  // Experimental digit diagnostic by voice (off by default): listens only during the diagnostic block.
  const listener = useRef<{ key: string; l: DigitListener } | null>(null);
  const [heardByKey, setHeardByKey] = useState<Record<string, { heard: Heard[]; error?: string }>>({});
  useEffect(() => {
    const key = `${s.blockIdx}:${s.attempt}`;
    const want = s.phase === 'active' && !!block?.params?.startsWith('diagnostic') && !!settings.flags.speechDiagnostic && s.pausedAtMs === null;
    if (want && !listener.current) {
      const l = new DigitListener(activeMs);
      l.start();
      listener.current = { key, l };
    } else if (!want && listener.current) {
      const { key: k, l } = listener.current;
      l.stop();
      listener.current = null;
      setHeardByKey((x) => ({ ...x, [k]: { heard: [...(x[k]?.heard ?? []), ...l.heard], error: l.error } }));
      // Kept per rep with the block, so a right call-out can confirm that rep's head turn (owner decision 2026-10-30).
      const log = extras.current.get(k)?.cueLog;
      if (log?.length && l.heard.length) setExtras(k, { callOuts: callOutsPerRep(log, l.heard) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phase, s.blockIdx, s.attempt, s.pausedAtMs]);
  useEffect(() => () => listener.current?.l.stop(), []);
  const modeObs = useLiveQuery(() => db.metricObservations.where('metricId').equals('correctResponseByDefenderAction').toArray(), []);
  const testRecordIds = new Set(data.records.filter((r) => r.kind === 'systemTest').map((r) => r.id));
  const seenFakes = useLiveQuery(() => db.defenderScenarios.filter((x) => !!x.feintDirection).reverse().limit(60).toArray(), [])?.filter((x) => !x.sessionRecordId || !testRecordIds.has(x.sessionRecordId)).slice(0, 40);
  const tendency = seenFakes?.length ? { leftShare: seenFakes.filter((x) => x.feintDirection === 'left').length / seenFakes.length, n: seenFakes.length } : undefined;
  const modeLevel = reactionModeLevel(modeObs ?? [], p.reactionModesProgression, (drillId, m) => !!drillId && progressionEligible(p, drillId, m));

  // Create the records as the run starts.
  useEffect(() => {
    setSoundSettings(settings.sound, p.voiceStyles);
    unlockAudio();
    createRun(plan, trial, { contentVersion: p.version, layoutVersion: layout?.version ?? 1, roomProfileId: data.roomProfile?.id, roomProfileVersion: data.roomProfile?.version, switches: switchSnapshot(settings) }).then(setIds);
    return () => stopSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handle = useCallback(
    (events: E.RunEvent[]) => {
      for (const ev of events) {
        if (ev.type === 'say') say(ev.text);
        else if (ev.type === 'tone') tone(ev.kind);
      }
    },
    [],
  );

  // Clock.
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      const r = E.tick(sRef.current, n, labels);
      if (r.state !== sRef.current) {
        sRef.current = r.state;
        setS(r.state);
      }
      handle(r.events);
    }, 200);
    return () => clearInterval(t);
  }, [labels, handle]);

  // The end-of-session save, retried from the card when it fails (audit 2026-10-29, task 8).
  const [saveError, setSaveError] = useState<string | null>(null);
  const finish = async () => {
    if (!ids) return;
    setSaveError(null);
    try {
      // Never wait forever for a clip (a camera unplugged mid-block, audit task 6).
      await Promise.race([camera.flush(), new Promise((r) => setTimeout(r, 15_000))]);
      const recs = await saveProgress(withExtras(sRef.current), ids, new Set(savedRef.current.map((r) => r.blockIndex)), true);
      await db.settings.update('main', { lastSeenAppVersion: APP_VERSION, lastSeenContentVersion: p.version });
      await recordMilestones(p);
      // Opt-in completion message (plan/14): one small record per completed session.
      void notifyFinished(p, recs).catch(() => undefined);
      if (recs[0]?.kind === 'systemTest') go({ name: 'parent', section: 'systest', arg: ids.runId });
      else if (recs[0]?.kind === 'baseline' && recs[0].status !== 'stopped') go({ name: 'baselineQuestions', recordId: recs[0].id });
      else go({ name: 'summary', runId: ids.runId });
    } catch (e) {
      setSaveError(saveFailedText(e));
    }
  };

  // Save after each block; finish when done.
  useEffect(() => {
    if (!ids) return;
    if (s.phase === 'done') {
      if (finishing.current) return;
      finishing.current = true;
      void finish();
    } else {
      // A failed per-block save shows the retry card at the end; the final save writes everything again.
      void saveProgress(withExtras(s), ids, benchmarksLogged, false).catch((e) => setSaveError(saveFailedText(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.results.length, s.phase === 'done', ids]);

  // Store how each block actually ran and which instructions went with it (Brief R01).
  useEffect(() => {
    if (s.phase !== 'active' || s.practice) return;
    const b = s.plan.blocks[s.blockIdx];
    const t = b ? resolveTraining(p, b, settings, data.roomProfile?.wallUsable) : null;
    if (t) setExtras(`${s.blockIdx}:${s.attempt}`, { trainingMode: t.mode, instructionVersion: t.version });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phase, s.blockIdx, s.attempt]);

  // The defender's frame rate: kept per block and written once, as the in-session value; the parent's
  // 3D defender test keeps its own number (audit task 12).
  const fpsSamples = useRef<number[]>([]);
  useEffect(
    () => () => {
      const f = fpsSamples.current;
      fpsSamples.current = [];
      if (!f.length) return;
      const median = [...f].sort((a, b) => a - b)[Math.floor(f.length / 2)];
      void db.settings
        .get('main')
        .then((st) => st && db.settings.update('main', { capabilities: { ...(st.capabilities ?? { checkedAt: new Date().toISOString(), webgl: true, webgl2: false }), sessionDefenderFps: median, sessionDefenderFpsAt: new Date().toISOString() } }));
    },
    [s.blockIdx, s.attempt],
  );

  // The screen stays on during a session; a hidden page (lid closed, screen off, another tab) pauses it,
  // and the session waits on the PAUSED screen for a tap (audit task 11). The pause counts toward the pause limits.
  useWakeLock(s.phase !== 'done');
  useEffect(() => {
    const onVis = () => {
      const st = sRef.current;
      if (document.visibilityState === 'hidden' && st.pausedAtMs === null && (st.phase === 'active' || st.phase === 'countdown')) apply(E.pause);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard (audit task 17): Space pauses and resumes; S held for 0.8 s stops, like the STOP button.
  // Keys typed into a form field or on a focused button are left to that element.
  useEffect(() => {
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, button, [contenteditable]');
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.repeat) return;
      const st = sRef.current;
      if (st.phase === 'done') return;
      if (e.code === 'Space' && (st.phase === 'active' || st.phase === 'countdown')) {
        e.preventDefault();
        apply(st.pausedAtMs === null ? E.pause : E.resume);
      } else if (e.code === 'KeyS' && !stopTimer) {
        stopTimer = setTimeout(() => {
          apply(E.stop);
          say('Stopped.', { interrupt: true });
        }, 800);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyS' && stopTimer) {
        clearTimeout(stopTimer);
        stopTimer = undefined;
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      if (stopTimer) clearTimeout(stopTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (fn: (st: E.RunState, n: number) => E.RunState | { state: E.RunState; events: E.RunEvent[] }) => {
    unlockAudio();
    const n = Date.now();
    const out = fn(sRef.current, n);
    const st = 'state' in out ? out.state : out;
    if ('events' in out) handle(out.events);
    sRef.current = st;
    setS(st);
  };

  const onStart = useCallback(
    (choiceDrillId?: string) => {
      apply((st, n) => {
        let next = st;
        if (choiceDrillId) {
          const d = p.drills.find((x) => x.id === choiceDrillId);
          next = { ...st, plan: { ...st.plan, blocks: st.plan.blocks.map((b, i) => (i === st.blockIdx ? { ...b, drillId: choiceDrillId, mode: d?.mode ?? b.mode } : b)) } };
        }
        return E.startBlock(next, n);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p],
  );

  const conditionsFor = (b: RunBlock, recordedBy: Conditions['recordedBy']): Conditions => ({
    layoutVersion: b.kind === 'anchor' ? 0 : layout?.version ?? 1,
    cueLevel: b.kind === 'anchor' ? anchorCueLevel(b) : b.cueLevel ?? 'std',
    floor: layout?.floor ?? 'hard',
    recorded: false,
    recordedBy,
    timing: b.benchmarkId === 'DB' || b.anchorId === 'A1' ? 'tap' : undefined,
    roomProfileVersion: b.kind !== 'anchor' && data.roomProfile ? `${data.roomProfile.id}@${data.roomProfile.version}` : undefined,
    // Anchors are assessed against the fixed, non-learning benchmark opponent (part 18).
    defenderArchetype: b.kind === 'anchor' ? 'benchmarkOpponent' : undefined,
    cameraConfidence: camera.live ? (camera.roomCheck?.status === 'moved' ? 'low' : 'ok') : 'none',
    // The base rules plus any personalised model the camera estimates used (part 18).
    modelVersion: camera.live ? modelVersionLabel(personalModels) : 'rules-1',
    ballProfileId: settings.flags.ballTracking && camera.live ? settings.activeBallProfileId : undefined,
    slotMinutes: b.slotMinutes,
  });

  // Anchors A3/A4 and cue accuracy record whether the app's cue engine ran the cues.
  const engineLevelFor = (idx: number) => extras.current.get(`${idx}:${sRef.current.attempt}`)?.cueLevel ?? [...extras.current.entries()].find(([k, v]) => k.startsWith(`${idx}:`) && v.cueLevel)?.[1].cueLevel;
  const anchorCueLevel = (b: RunBlock) => (b.anchorId === 'A3' || b.anchorId === 'A4' ? engineLevelFor(sRef.current.blockIdx) ?? 'manual-switchedon' : 'std');
  const caCueLevel = (b: RunBlock) => {
    const cueBlocks = sRef.current.plan.blocks.map((x, i) => (x.kind === 'work' && x.partIndex === b.partIndex ? i : -1)).filter((i) => i >= 0);
    for (const i of cueBlocks) {
      const lvl = engineLevelFor(i);
      if (lvl) return lvl;
    }
    return 'manual-switchedon';
  };

  async function logBenchmark(
    b: RunBlock,
    benchmarkId: string,
    values: BenchmarkValues,
    recordedBy: Conditions['recordedBy'],
    drillId?: string,
    prefilledFrom?: 'camera',
    camera?: { estimate?: BenchmarkResult['cameraEstimate']; validatedBy?: string },
  ) {
    if (!ids) return;
    const name = p.benchmarks.find((x) => x.id === benchmarkId)?.name;
    const res = await saveBenchmark({
      recordId: recordIdForBlock(s.plan, ids, s.blockIdx),
      blockIndex: s.blockIdx,
      attempt: s.attempt,
      benchmarkId,
      areaId: b.areaId,
      drillId,
      conditions: { ...conditionsFor(b, recordedBy), ...(recordedBy === 'app' && camera?.validatedBy ? { validatedBy: camera.validatedBy } : {}) },
      values,
      prefilledFrom,
      cameraEstimate: camera?.estimate,
      // A player's score is weighed against earlier results and recent practice (owner decision 2026-10-30).
      weigh: { earlier: countedResults(data.results, data.records), practiceDrillId: drillId ?? p.anchors.find((a) => a.name === name)?.drillId },
    });
    setSaved((x) => [...x, res]);
    const q = await saveProgress(withExtras(sRef.current), ids, new Set([...savedRef.current.map((r) => r.blockIndex), s.blockIdx]), false);
    void q;
  }

  /** For scan decision tests (3 balanced outcomes): how often guessing alone would reach the score (task 4.3). */
  const chanceLineFor = (rs: BenchmarkResult[]): string | undefined => {
    const r = rs.find((x) => x.values.kind === 'SB' || x.values.kind === 'A4');
    if (!r || (r.values.kind !== 'SB' && r.values.kind !== 'A4')) return undefined;
    const k = p.cueDrills.find((c) => c.id === (p.benchmarkCueDrills?.SB ?? 'cue-scan'))?.values?.length ?? 3;
    return tryFill(p.feedbackTemplates, 'chanceLine', { correct: r.values.correct, n: 10, k, pct: chancePct(chanceTail(r.values.correct, 10, k)) }) ?? undefined;
  };

  // This block's camera analysis, for the anchor card's estimate (D10).
  const blockAnalysis = useBlockAnalysis(ids ? recordIdForBlock(s.plan, ids, s.blockIdx) : undefined, s.blockIdx, s.attempt);
  if (!ids) return <div className="practice"><div className="sub">Starting…</div></div>;

  const pauseBtn =
    s.pausedAtMs !== null ? (
      <button className="btn go" onClick={() => apply(E.resume)}>
        RESUME
      </button>
    ) : (
      <button className="btn" onClick={() => apply(E.pause)}>
        PAUSE
      </button>
    );
  // Back to the block's instructions (and its cone set-up); the block then starts again.
  const instructionsBtn = E.isDrillBlock(block) ? (
    <button className="btn" onClick={() => apply(E.restartWithInstructions)}>
      ↺ Instructions
    </button>
  ) : null;
  // The warm-up can be skipped (one tap). A session without a finished warm-up is partial (plan/14.4).
  const skipWarmupBtn = (
    <button
      className="btn"
      onClick={() => {
        apply(E.skip);
        say('Warm-up skipped.', { interrupt: true });
      }}
    >
      Skip warm-up
    </button>
  );
  // Press and hold (0.8 s): a stray tap cannot end the session; not a confirmation dialog (audit task 13).
  const stopBtn = (
    <HoldButton
      className="btn danger"
      label="STOP"
      onHold={() => {
        apply(E.stop);
        say('Stopped.', { interrupt: true });
      }}
    />
  );

  // ----- Demo view -----
  if (s.phase === 'demo') {
    return (
      <DemoPanel
        key={s.blockIdx}
        // After a "Try it" round the cones are already out: straight to the instructions.
        conesChanged={conesChanged(s.plan.blocks, s.blockIdx, p) && !s.results.some((r) => r.index === s.blockIdx && r.practice)}
        onPractice={cueDrillFor(p, block) && settings.cueEngine ? () => apply(E.startPractice) : undefined}
        block={block}
        blockNo={s.blockIdx + 1}
        blockCount={s.plan.blocks.length}
        autoStartS={settings.demoAutoStartS}
        phaseStartMs={s.phaseStartMs}
        paused={s.pausedAtMs !== null}
        onStart={onStart}
        onSkip={() => apply(E.skip)}
        onStop={() => apply(E.stop)}
        framing={camera.framing}
        cameraError={camera.error}
        roomCheck={camera.roomCheck}
      />
    );
  }

  // ----- End-of-drill card -----
  if (s.phase === 'card' && s.practice) {
    return (
      <PracticeCard
        p={p}
        block={block}
        recordId={ids ? recordIdForBlock(s.plan, ids, s.blockIdx) : undefined}
        blockIndex={s.blockIdx}
        log={extras.current.get(`${s.blockIdx}:0`)?.cueLog ?? []}
        onAgain={() => apply(E.repeat)}
        onInstructions={() => apply(E.next)}
        onReal={() => apply((st, t) => E.startBlock(E.next(st, t), t))}
      />
    );
  }

  if (s.phase === 'card') {
    const attempts = s.results.filter((r) => r.index === s.blockIdx);
    const blockSaved = saved.filter((r) => r.blockIndex === s.blockIdx);
    const thisAttemptSaved = blockSaved.filter((r) => r.attempt === s.attempt);
    const benchKind = (block.kind === 'benchmark' ? block.benchmarkId : block.kind === 'anchor' ? block.anchorId : undefined) as FormKind | undefined;
    const benchSkipKey = `${s.blockIdx}:${s.attempt}`;
    const needsMain = benchKind && !thisAttemptSaved.some((r) => r.benchmarkId === benchKind) && !skippedBench.has(benchSkipKey);
    const needsCA = block.alsoCueAccuracy && !thisAttemptSaved.some((r) => r.benchmarkId === 'CA') && !skippedBench.has(benchSkipKey + ':CA');
    // A defender block without a camera result: one optional result card for the block's decisions (D10: blank, one confirm).
    if (block.params?.startsWith('diagnostic') && !tallied.has(benchSkipKey)) {
      return (
        <div className="page">
          <DiagnosticCard
            key={benchSkipKey}
            speech={
              heardByKey[benchSkipKey]
                ? { ...scoreDigits(extras.current.get(benchSkipKey)?.cueLog ?? [], heardByKey[benchSkipKey].heard), error: heardByKey[benchSkipKey].error }
                : undefined
            }
            context={{ drillId: block.drillId, layoutVersion: layout?.version ?? 1, cueLevel: extras.current.get(benchSkipKey)?.cueLevel ?? 'manual' }}
            recordId={recordIdForBlock(s.plan, ids, s.blockIdx)}
            blockIndex={s.blockIdx}
            onDone={() => setTallied((x) => new Set([...x, benchSkipKey]))}
          />
        </div>
      );
    }
    const def = extras.current.get(benchSkipKey)?.defender;
    if (def && def.reps > 0 && !systemTest && !tallied.has(benchSkipKey) && !camera.live && !extras.current.get(benchSkipKey)?.clipId) {
      return (
        <div className="page">
          <DefenderTally
            key={benchSkipKey}
            title={blockName(block)}
            reps={def.reps}
            context={{ drillId: block.drillId, layoutVersion: layout?.version ?? 1, cueLevel: extras.current.get(benchSkipKey)?.cueLevel ?? 'defender', defenderArchetype: def.archetype, roomProfileVersion: data.roomProfile ? `${data.roomProfile.id}@${data.roomProfile.version}` : undefined, taskMode: def.view, cameraConfidence: 'none', settings: defCfgs.current.get(benchSkipKey)?.modeLevel !== undefined ? levelTag(defCfgs.current.get(benchSkipKey)!.modeLevel!) : undefined }}
            recordId={recordIdForBlock(s.plan, ids, s.blockIdx)}
            blockIndex={s.blockIdx}
            onDone={() => setTallied((x) => new Set([...x, benchSkipKey]))}
          />
        </div>
      );
    }

    if (benchKind && (needsMain || needsCA)) {
      const kind: FormKind = needsMain ? benchKind : 'CA';
      const id = needsMain ? benchKind : 'CA';
      const cueLevel = block.kind === 'anchor' ? anchorCueLevel(block) : kind === 'CA' ? caCueLevel(block) : block.cueLevel ?? 'std';
      const workDrills = s.plan.blocks.filter((b) => b.kind === 'work' && b.partIndex === block.partIndex && b.drillId).map((b) => b.drillId as string);
      const caDrill = workDrills[0];
      // "Scored by" is chosen on the card each time; never carried over from an earlier session.
      const cond = { ...conditionsFor(block, 'parent'), cueLevel };
      const shown = digitsShown[`${s.blockIdx}:${s.attempt}`];
      const prefill = (PREFILL_KINDS as readonly string[]).includes(kind) && blockAnalysis?.clip ? cameraPrefill(kind as PrefillKind, blockAnalysis.a, blockAnalysis.reps) : null;
      // The camera may score this test on its own when its measure passed validation (owner decision 2026-10-30).
      const validatedBy = capstoneGates(p, settings).gates.find((g) => g.passed && p.capstone.components.find((c) => c.id === g.id)?.scoresTests?.includes(id))?.id;
      return (
        <div className="page">
          <div className="stack">
            {shown?.length ? <div className="card tight">Digits shown in order: <span className="mono">{shown.join(' ')}</span></div> : null}
            <BenchmarkForm
              key={`${s.blockIdx}-${s.attempt}-${kind}`}
              kind={kind}
              title={kind === 'CA' ? `Cue accuracy · ${caDrill ?? ''}` : blockName(block)}
              conditions={cond}
              initial={initialValues(kind, cueLevel, times[`${s.blockIdx}:${s.attempt}`])}
              hasEstimate={!!times[`${s.blockIdx}:${s.attempt}`] && (kind === 'DB' || kind === 'A1')}
              camera={prefill}
              cameraValidated={!!validatedBy}
              onCameraUsed={(used) => (cameraUsed.current = used)}
              onSave={(values, by) =>
                logBenchmark(block, id, values, by, kind === 'CA' ? caDrill : block.kind === 'anchor' ? block.drillId : undefined, cameraUsed.current ? 'camera' : undefined, {
                  estimate: prefill?.values,
                  validatedBy,
                })
              }
              onSkip={() => setSkippedBench((x) => new Set([...x, kind === 'CA' ? benchSkipKey + ':CA' : benchSkipKey]))}
            />
          </div>
        </div>
      );
    }
    const lastAttempt = attempts[attempts.length - 1];
    const quizLine = (block.kind === 'quiz' || block.drillId === quizDrill) && quizRounds.length ? `Rounds: ${quizRounds.map((c) => `${c}/${p.quiz.items}`).join(' · ')}` : undefined;
    return (
      <EndCard
        key={`${s.blockIdx}-${s.attempt}`}
        block={block}
        title={blockName(block)}
        attempts={attempts}
        saved={blockSaved}
        runId={ids.runId}
        trial={trial}
        autoAdvanceS={settings.cardAutoAdvanceS}
        phaseStartMs={s.phaseStartMs}
        onRepeat={() => apply(E.repeat)}
        onNext={() => {
          setQuizRounds([]);
          apply(E.next);
        }}
        kept={!!lastAttempt?.keptAt}
        onKeep={systemTest ? undefined : async () => {
          const at = new Date().toISOString();
          apply((st) => ({ ...st, results: st.results.map((r) => (r.index === st.blockIdx ? { ...r, keptAt: at } : r)) }));
          for (const r of blockSaved) await db.benchmarkResults.update(r.id, { keptAt: at });
        }}
        onNote={(text) => apply((st) => ({ ...st, results: st.results.map((r) => (r === lastAttempt ? { ...r, note: text } : r)) }))}
        extraLine={[quizLine ?? chanceLineFor(blockSaved), camera.clipError || undefined].filter(Boolean).join(' ') || undefined}
        recordId={recordIdForBlock(s.plan, ids, s.blockIdx)}
      />
    );
  }

  // ----- Countdown -----
  if (s.phase === 'countdown') {
    const left = Math.ceil(E.countdownLeftS(s, now, p.builder.countdownS));
    return (
      <div className={`practice countdown ${s.pausedAtMs !== null ? 'paused' : ''}`}>
        <div className="drill">{blockName(block)}</div>
        <div className="clock">{left}</div>
        <div className="sub">{block.kind === 'warmup' ? 'Get ready' : startText(p, block)}</div>
        <div className="controls">
          {pauseBtn}
          {block.kind === 'warmup' ? skipWarmupBtn : instructionsBtn ?? <span />}
          {stopBtn}
        </div>
      </div>
    );
  }

  if (s.phase === 'done' && saveError)
    return (
      <div className="page" data-testid="save-error">
        <div className="card stack">
          <h1 style={{ margin: 0 }}>Not saved yet</h1>
          <p style={{ fontSize: '1.3rem' }}>{saveError}</p>
          <button className="btn go huge" onClick={() => void finish()}>
            Try again
          </button>
        </div>
      </div>
    );
  if (s.phase === 'done') return <div className="practice"><div className="sub">Saving…</div></div>;

  // ----- Practice view (active) -----
  const remaining = E.remainingS(s, now);
  const total = block.minutes * 60;
  const nextBlock = s.plan.blocks[s.blockIdx + 1];
  const isRest = ['rest', 'transition', 'break'].includes(block.kind);
  const canDone = block.mode === 'reps' || !['work', 'warmup'].includes(block.kind);
  const doneLabel = ['work', 'benchmark', 'anchor', 'quiz'].includes(block.kind) ? 'DONE' : 'NEXT BLOCK';

  const defCfg = defenderConfigFor_(block);
  const cueCfg = defCfg ? null : cueConfigFor_(block);
  const benchId = block.kind === 'benchmark' ? block.benchmarkId : block.kind === 'anchor' ? block.anchorId : undefined;
  if (benchId && TIMED_RUN_KINDS.has(benchId) && !times[`${s.blockIdx}:${s.attempt}`] && s.pausedAtMs === null) {
    return (
      <TimedRuns
        headUp={block.cueLevel === 'headup'}
        activeMs={activeMs}
        onFinished={(t, digits, windows) => {
          setExtras(`${s.blockIdx}:${s.attempt}`, { windows });
          setTimes((x) => ({ ...x, [`${s.blockIdx}:${s.attempt}`]: t }));
          setDigitsShown((x) => ({ ...x, [`${s.blockIdx}:${s.attempt}`]: digits }));
          apply(E.done);
        }}
      />
    );
  }
  // CB-1: timed V-pull windows per foot first, then the gate test in the rest of the block.
  if (benchId === 'CB' && s.phase === 'active' && !vPullsDone.has(`${s.blockIdx}:${s.attempt}`) && s.pausedAtMs === null) {
    return (
      <VPullWindows
        activeMs={activeMs}
        onFinished={(windows) => {
          const key = `${s.blockIdx}:${s.attempt}`;
          setExtras(key, { windows });
          setVPullsDone((x) => new Set([...x, key]));
        }}
      />
    );
  }
  if ((block.kind === 'quiz' || block.drillId === quizDrill) && s.pausedAtMs === null) {
    return (
      <PictureQuiz
        key={quizRounds.length}
        quiz={p.quiz}
        onDone={async (correct, outOf) => {
          setQuizRounds((r) => [...r, correct]);
          if (quizRounds.length === 0) await logBenchmark(block, 'QUIZ', { kind: 'QUIZ', correct, outOf }, 'app', p.quiz.drillId);
        }}
      />
    );
  }

  const practiceHeader = (
    <span>
      {camera.recording ? <span style={{ color: '#ff3b3b' }}>● </span> : null}
      {blockName(block)} · {fmtClock(remaining)}
      {trial ? ' · trial' : ''}
    </span>
  );
  const practiceControls = (
    <>
      {pauseBtn}
      {canDone ? (
        <button className="btn primary" onClick={() => apply(E.done)}>
          {doneLabel}
        </button>
      ) : (
        <span />
      )}
      {stopBtn}
    </>
  );

  if (defCfg) {
    const key = `${s.blockIdx}:${s.attempt}`;
    return (
      <DefenderBlock
        key={key}
        config={defCfg}
        activeMs={activeMs}
        paused={s.pausedAtMs !== null}
        onLog={(scen, view, fallbackReason) => {
          setExtras(key, {
            cueLevel: `defender-${view === 'player3d' ? '3d' : '2d'}-${defCfg.archetype}`,
            defender: { view, archetype: defCfg.archetype, reps: scen.length, triggerSources: [...new Set(scen.map((x) => x.triggerSource))], fallbackReason, scenarioIds: scen.map((x) => x.id) },
          });
          const recordId = recordIdForBlock(sRef.current.plan, ids, sRef.current.blockIdx);
          const last = scen[scen.length - 1];
          if (last) void db.defenderScenarios.put({ ...last, sessionRecordId: recordId, blockIndex: sRef.current.blockIdx, attempt: sRef.current.attempt });
        }}
        input={defCfg.trigger === 'cameraOnset' && camera.live ? camera.defenderInput : undefined}
        onFps={(fps) => fpsSamples.current.push(fps)}
        onRepsDone={() => {
          if (block.mode === 'reps' || s.practice) apply(E.done);
        }}
        header={practiceHeader}
        controls={practiceControls}
      />
    );
  }

  if (cueCfg) {
    return (
      <CueBlock
        key={`${s.blockIdx}:${s.attempt}`}
        config={cueCfg}
        activeMs={activeMs}
        paused={s.pausedAtMs !== null}
        onLog={(log) => setExtras(`${s.blockIdx}:${s.attempt}`, { cueLog: log, cueLevel: engineCueLevel(cueCfg) })}
        input={wallSound ? () => ({ tripwireMs: bangAt.current }) : camera.cueInput}
        onRepsDone={() => {
          if (block.mode === 'reps' || s.practice) apply(E.done);
        }}
        header={
          <span>
            {camera.recording ? <span style={{ color: '#ff3b3b' }}>● </span> : null}
            {s.practice ? 'Try it (slow) · ' : ''}
            {wallSound ? (mic === 'listening' ? '🎤 kick at the wall · ' : mic === 'blocked' ? 'microphone off: words on a timer · ' : '') : ''}
            {blockName(block)} · {fmtClock(remaining)}
            {trial ? ' · trial' : ''}
            {cueRuleLine(p, block) ? <span className="cue-rule-line"> · {cueRuleLine(p, block)}</span> : null}
          </span>
        }
        controls={
          <>
            {pauseBtn}
            {canDone ? (
              <button className="btn primary" onClick={() => apply(E.done)}>
                {doneLabel}
              </button>
            ) : (
              <span />
            )}
            {instructionsBtn}
            {stopBtn}
          </>
        }
      />
    );
  }

  return (
    <div className={`practice ${s.pausedAtMs !== null ? 'paused' : isRest ? 'rest' : ''}`}>
      <div>
        <div className="drill">{s.practice ? 'Try it: ' : ''}{blockName(block)}</div>
        <div className="meta">
          {camera.recording ? <span style={{ color: '#ff3b3b' }}>● rec · </span> : null}
          Block {s.blockIdx + 1} of {s.plan.blocks.length}
          {s.attempt > 1 ? ` · attempt ${s.attempt}` : ''}
          {trial ? ' · trial' : ''}
        </div>
      </div>
      {block.drillId === 'D4' && s.pausedAtMs === null ? <DigitFlasher size="38vh" /> : <div className="clock">{s.pausedAtMs !== null ? 'PAUSED' : fmtClock(remaining)}</div>}
      <div>
        <div className="sub">
          {block.drillId === 'D4' ? `${fmtClock(remaining)} · ` : ''}
          {isRest && nextBlock ? `Next: ${blockName(nextBlock)}` : block.params ? block.params : block.kind === 'benchmark' ? 'Benchmark' : ''}
          {(() => {
            const set = !isRest && s.phase === 'active' ? E.setAt(setsFor(block), total - remaining, total) : null;
            return set ? `${block.params ? ' · ' : ''}set ${set.index} of ${set.count}${set.label ? ` · ${set.label}` : ''}` : null;
          })()}
        </div>
        <div className="bar" style={{ marginTop: '1.5vh' }}>
          <div style={{ width: `${Math.min(100, (100 * (total - remaining)) / total)}%` }} />
        </div>
      </div>
      <div className="controls">
        {pauseBtn}
        {block.kind === 'warmup' ? (
          skipWarmupBtn
        ) : canDone ? (
          <button className="btn primary" onClick={() => apply(isRest || block.kind === 'log' || block.kind === 'mobility' || block.kind === 'cooldown' ? E.skip : E.done)}>
            {doneLabel}
          </button>
        ) : (
          <span className="sub" style={{ alignSelf: 'center' }}>
            Runs by itself
          </span>
        )}
        {instructionsBtn}
        {stopBtn}
      </div>
    </div>
  );
}

/** "Walk to the start", with where the start is for this block's layout (content: layouts[id].start). */
function startText(p: import('../content/types').Programme, block: RunBlock | undefined): string {
  const id = blockLayout(p, block);
  const where = id ? p.layouts[id]?.start : undefined;
  return where ? `Walk to the start. ${where}` : 'Walk to the start';
}

