import { DrillAnimation } from '../ui/DrillAnimation';
import { scriptFor } from '../ui/drillScripts';
import { scanModeFor } from '../domain/scan';
import { tryFill } from '../domain/templates';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useData } from '../app/data';
import type { Drill } from '../content/types';
import { layoutSummary } from '../domain/layout';
import { localiseText } from '../domain/units';
import type { RunBlock } from '../domain/plans';
import { fmtDate } from '../ui/widgets';
import { DemoVideo } from './DemoVideo';
import { blockLayout, ConeSetup } from './ConeSetup';
import { cueDrillFor } from '../cue/resolve';
import { TurnOnNeeded } from './TurnOnNeeded';
import { CueRules, talkThrough } from './CueRules';
import { say, stopSpeech } from '../audio/audio';

export function benchmarkName(p: ReturnType<typeof useData>['programme'], id?: string): string {
  if (!id) return '';
  return p.benchmarks.find((b) => b.id === id)?.name ?? p.anchors.find((a) => a.id === id)?.name ?? id;
}

/** Demonstration view (plan/02 §2.5). One tap starts the block; it also starts on its own unless a video is playing. */
export function DemoPanel(props: {
  block: RunBlock;
  blockNo: number;
  blockCount: number;
  autoStartS: number;
  phaseStartMs: number;
  paused: boolean;
  onStart: (choiceDrillId?: string) => void;
  onSkip: () => void;
  onStop: () => void;
  framing?: import('../camera/frames').FramingResult | null;
  cameraError?: string;
  roomCheck?: import('../camera/roomCheck').RoomCheck | null;
  /** The cones must be moved for this block: the set-up comes first and the block waits longer. */
  conesChanged?: boolean;
  /** "Try it": a slow practice round of this block, checked by the camera (cue blocks only). */
  onPractice?: () => void;
}) {
  const { block, blockNo, blockCount, phaseStartMs, paused, onStart, onSkip, onStop, framing, cameraError, roomCheck, conesChanged, onPractice } = props;
  const { programme: p, notes, layout, demoClipIds, roomProfile, settings } = useData();
  const units = settings.units ?? 'metric';
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [heldMs, setHeldMs] = useState(0); // time the auto-start was held (video playing, paused, or Hold)
  const [holding, setHolding] = useState(false);
  const [talking, setTalking] = useState(false); // the voice is reading the instructions
  const talkingRef = useRef(false);
  talkingRef.current = talking;
  // Two steps when the cones move: set them out (and confirm), then the instructions.
  const [stage, setStage] = useState<'cones' | 'instructions'>(conesChanged && blockLayout(p, block) ? 'cones' : 'instructions');
  const [stageStartMs, setStageStartMs] = useState(phaseStartMs);
  const onPlayingChange = useCallback((v: boolean) => setPlaying(v), []);

  const isChoice = block.drillId === 'choice';
  const drill: Drill | undefined = p.drills.find((d) => d.id === block.drillId);
  const anchor = block.anchorId ? p.anchors.find((a) => a.id === block.anchorId) : undefined;
  const bench = block.benchmarkId ? p.benchmarks.find((b) => b.id === block.benchmarkId) : undefined;
  const title = drill?.name ?? anchor?.name ?? (bench ? `Benchmark · ${bench.name}` : block.kind === 'quiz' ? 'Picture quiz' : 'Player’s choice');
  const shownDrill = drill;
  const drillNotes = notes.filter((n) => !n.resolvedAt && n.target.kind === 'drill' && n.target.id === (shownDrill?.id ?? '')).sort((a, b) => b.date.localeCompare(a.date));
  const sets = layout ? layoutSummary(layout.derived, units) : {};
  const scanMode = scanModeFor(p, drill, block.params, roomProfile);

  const autoStartS = stage === 'cones' ? (settings.coneSetupS ?? 60) : props.autoStartS;
  const lastTick = useRef(Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      if (playing || paused || holding || talkingRef.current) setHeldMs((h) => h + (n - lastTick.current));
      lastTick.current = n;
      setNow(n);
    }, 250);
    return () => clearInterval(t);
  }, [playing, paused, holding]);

  const left = Math.max(0, Math.ceil(autoStartS - (now - stageStartMs - heldMs) / 1000));
  const toInstructions = useCallback(() => {
    setStage('instructions');
    setStageStartMs(Date.now());
    setHeldMs(0);
    setHolding(false);
    lastTick.current = Date.now();
  }, []);
  useEffect(() => {
    if (left > 0 || playing || paused || holding || talking) return;
    if (stage === 'cones') toInstructions();
    else if (!isChoice) onStart();
  }, [left, playing, paused, holding, isChoice, onStart, stage, toInstructions]);
  // The voice talks through the instructions (once per showing), unless she knows this drill.
  const talkKey = block.drillId ?? block.benchmarkId ?? block.anchorId ?? block.kind;
  const knows = (settings.talkThroughSkip ?? []).includes(talkKey);
  const talkText = talkThrough(p, block, title, roomProfile?.wallUsable);
  const readOut = useCallback(() => {
    if (!settings.sound.speech) return;
    setTalking(true);
    say(talkText, { interrupt: true });
  }, [talkText, settings.sound.speech]);
  useEffect(() => {
    if (stage !== 'instructions' || isChoice || knows || settings.talkThrough === false) return;
    readOut();
    return () => stopSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);
  useEffect(() => {
    if (!talking) return;
    const t = setInterval(() => {
      if (!window.speechSynthesis?.speaking) setTalking(false);
    }, 400);
    return () => clearInterval(t);
  }, [talking]);
  const skipTalk = () => {
    stopSpeech();
    setTalking(false);
  };
  const setKnows = (v: boolean) => {
    const cur = new Set(settings.talkThroughSkip ?? []);
    if (v) cur.add(talkKey);
    else cur.delete(talkKey);
    void db.settings.update('main', { talkThroughSkip: [...cur] });
    if (v) skipTalk();
  };
  const talkControls = isChoice ? null : (
    <div className="row" style={{ flexWrap: 'wrap' }} data-testid="talk-controls">
      {talking ? (
        <button className="btn" onClick={skipTalk}>
          ⏭ Skip the talk-through
        </button>
      ) : (
        <button className="btn" onClick={readOut}>
          🔊 Read it out
        </button>
      )}
      <label className="check">
        <input type="checkbox" checked={knows} onChange={(e) => setKnows(e.target.checked)} />
        She knows this one: don't read it out next time
      </label>
    </div>
  );
  const holdBtn = (
    <button className="btn" aria-pressed={holding} onClick={() => setHolding(!holding)}>
      {holding ? '▶ Resume the countdown' : '⏸ Hold'}
    </button>
  );

  const layoutId = blockLayout(p, block);

  // Step 1 (when the cones move): set them out, then confirm. Nothing starts from here.
  if (stage === 'cones' && layoutId) {
    return (
      <div className="demo demo-cones" data-testid="cones-step">
        <div className="card stack" style={{ overflow: 'auto' }}>
          <div className="muted">
            Block {blockNo} of {blockCount} · step 1 of 2: cones
          </div>
          <h1 style={{ textTransform: 'uppercase', margin: 0 }}>{title}</h1>
          <ConeSetup layoutId={layoutId} changed />
        </div>
        <div className="col">
          <button className="btn go huge" onClick={toInstructions}>
            ✓ Cones are out: show the instructions
          </button>
          <div className="row spread">
            <span className="muted">{holding ? 'On hold' : `Shows the instructions by itself in ${left} s`}</span>
            <div className="row">
              {holdBtn}
              <button className="btn" onClick={onSkip}>
                Skip block
              </button>
              <button className="btn danger" onClick={onStop}>
                STOP
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="demo">
      <div className="card stack" style={{ overflow: 'auto' }}>
        <div className="muted">
          Block {blockNo} of {blockCount} · {block.minutes} min{block.params ? ` · ${block.params}` : ''}
          {block.cueLevel ? ` · level ${block.cueLevel}` : ''}
        </div>
        <h1 style={{ textTransform: 'uppercase' }}>{title}</h1>
        {layoutId && layout ? (
          <details>
            <summary>{conesChanged ? 'Cones (tap to see the plan again)' : 'Cones: same as the last block (tap to see)'}</summary>
            <ConeSetup layoutId={layoutId} changed={false} />
          </details>
        ) : null}
        <TurnOnNeeded blocks={[block]} />
        {talkControls}
        <CueRules p={p} block={block} wall={roomProfile?.wallUsable} />
        {drill ? (
          <DetailFold folded={!!cueDrillFor(p, block)}>
            <p>
              <strong>Purpose:</strong> {drill.purpose}
            </p>
            <p>
              <strong>Set-up:</strong> {layoutId ? `${layoutId} ${p.layouts[layoutId]?.name} — ${sets[layoutId] ?? localiseText(p.layouts[layoutId]?.setup ?? '', units)}. ` : ''}
              {localiseText(drill.setupText, units)}
            </p>
            <p>
              <strong>Do:</strong> {localiseText(drill.prescription, units)}
            </p>
            {scanMode ? <p className="pill info">{tryFill(p.feedbackTemplates, 'scanMode', { mode: scanMode.label, note: scanMode.note })}</p> : null}
            <div>
              <strong>Cues:</strong>
              <ul>
                {drill.cues.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <p className="muted">Common errors: {drill.commonErrors.join(' · ')}</p>
            <p className="muted">Safety: {drill.safety}</p>
            {layoutId ? <RoomOverlay layoutId={layoutId} /> : null}
          </DetailFold>
        ) : null}
        {anchor ? (
          <p>
            <strong>Fixed conditions:</strong>{' '}
            {Object.entries(anchor.conditions)
              .map(([k, v]) => `${k} ${Array.isArray(v) ? v.join('/') : String(v)}`)
              .join(' · ')}
          </p>
        ) : null}
        {bench ? (
          <p>
            <strong>Test:</strong> {bench.protocol}
          </p>
        ) : null}
        {block.kind === 'quiz' ? <p>{p.quiz.note}</p> : null}
        {isChoice ? (
          <div className="stack">
            <strong>Pick the drill for this block:</strong>
            <div className="grid3">
              {p.drills
                .filter((d) => d.areaId === block.areaId)
                .map((d) => (
                  <button key={d.id} className="btn xl" onClick={() => onStart(d.id)}>
                    {d.id} · {d.name}
                  </button>
                ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="col">
        {shownDrill ? <DemoVideo drill={shownDrill} hasOwnClip={demoClipIds.includes(shownDrill.id)} onPlayingChange={onPlayingChange} /> : <div className="video muted">No video for this block</div>}
        {shownDrill && layout && scriptFor(shownDrill.id, layout.derived, layout.roomLengthM) ? (
          <DrillAnimation drillId={shownDrill.id} d={layout.derived} lengthM={layout.roomLengthM} widthM={layout.roomWidthM} floor={layout.floor} units={units} screenBehindM={p.layoutGeometry.receiveBox.cueScreenBehindM} maxHeight={300} />
        ) : null}
        {framing ? (
          <div className="row" style={{ fontSize: '1.3rem' }}>
            <span style={{ width: 28, height: 28, borderRadius: 14, display: 'inline-block', background: framing.ok ? 'var(--go)' : 'var(--stop)' }} />
            <span>{framing.message}</span>
          </div>
        ) : null}
        {roomCheck && roomCheck.status !== 'matched' ? (
          <div className="muted" data-testid="room-check">
            {roomCheck.message}
            {roomCheck.status === 'moved' ? ' This session is camera-unverified: clips are kept, the presence rule is not applied.' : ''}
          </div>
        ) : cameraError ? (
          <div className="muted">Camera not available ({cameraError}); this block is not recorded.</div>
        ) : null}
        {drillNotes.map((n) => (
          <div key={n.id} className="note-box">
            Coach note ({fmtDate(n.date)}): “{n.body}”
          </div>
        ))}
        {!isChoice && onPractice ? (
          <button className="btn xl" onClick={onPractice} data-testid="try-it">
            Try it first: 3 slow reps, checked by the camera
          </button>
        ) : null}
        {!isChoice ? (
          <button className="btn go huge" onClick={() => onStart()}>
            ▶ Start block
          </button>
        ) : null}
        <div className="row spread">
          <span className="muted">{isChoice ? '' : holding ? 'On hold' : talking ? 'Starts after the talk-through' : playing ? 'Starts when the video is paused' : paused ? 'Paused' : `Starts by itself in ${left} s`}</span>
          <div className="row">
            {!isChoice ? holdBtn : null}
            <button className="btn" onClick={onSkip}>
              Skip block
            </button>
            <button className="btn danger" onClick={onStop}>
              STOP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The saved room photo with the confirmed (or suggested) cone positions for this layout (plan/13 §13.1). */
function RoomOverlay({ layoutId }: { layoutId: string }) {
  const { roomProfile, layout } = useData();
  const inst = useLiveQuery(() => db.layoutInstances.where('roomProfileId').equals(roomProfile?.id ?? '').toArray(), [roomProfile?.id]);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!roomProfile?.backgroundFrame) return;
    const u = URL.createObjectURL(roomProfile.backgroundFrame);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [roomProfile?.backgroundFrame]);
  const mine = (inst ?? []).filter((i) => i.layoutId === layoutId).sort((a, b) => b.layoutVersion - a.layoutVersion)[0];
  if (!url || !mine) return null;
  return (
    <div style={{ position: 'relative', maxWidth: 420 }}>
      <img src={url} alt="Room photo with cone positions" style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {mine.observedConePositionsNormalized.map((c) => (
          <circle key={c.name} cx={c.pt.x} cy={c.pt.y} r={0.015} fill="#ff8a00" stroke="#000" strokeWidth={0.003} />
        ))}
      </svg>
      <div className="muted" style={{ fontSize: '0.8rem' }}>
        Cones by eye, roughly where the dots are{mine.layoutVersion !== layout?.version ? ' (positions from an earlier layout version)' : ''}.
      </div>
    </div>
  );
}

/** For cue drills the plain "How to do it" box is what to read; the full drill text folds away for the parent or coach. */
function DetailFold({ folded, children }: { folded: boolean; children: ReactNode }) {
  if (!folded) return <>{children}</>;
  return (
    <details>
      <summary>More detail (for the parent or coach)</summary>
      {children}
    </details>
  );
}

