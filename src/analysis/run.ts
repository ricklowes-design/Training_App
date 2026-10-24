import type { DefenderScenario, FeintRep, ScanRep } from '../db/types';
import type { RepAnalysis } from './types';
import { scenariosToLog } from '../defender/analysisLog';
import type { Programme } from '../content/types';
import type { CueLogEntry } from '../cue/engine';
import { db } from '../db/db';
import type { CameraSetup, Clip } from '../db/types';
import type { RunBlock } from '../domain/plans';
import type { DrillKind } from './compute';
import type { FromWorker, ToWorker } from './worker';

// After-block analysis pipeline (plan/08 §8.4). The clip plays in a hidden video
// element; frames go to the worker, which does all the measuring. One block at a
// time, in the background, while the next block runs.

const KIND: Record<string, DrillKind> = { L1: 'slalom', L2: 'feint', L3: 'scan', L4: 'control' };
const FRAME_W = 480;
const FRAME_H = 270;
const MAX_IN_FLIGHT = 4;

export const wasmBase = () => new URL('./mediapipe/', document.baseURI).href;

let queue: Promise<unknown> = Promise.resolve();

export function newWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

function call(worker: Worker, msg: ToWorker, transfer: Transferable[] = []): void {
  worker.postMessage(msg, transfer);
}

/** Plays a clip and hands frames (as ImageBitmaps) to `onFrame` at about `fps`. */
export async function playFrames(
  blob: Blob,
  fps: number,
  rate: number,
  onFrame: (tMs: number, bmp: ImageBitmap) => boolean | Promise<boolean>,
  maxFrames = Infinity,
): Promise<number> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  let sent = 0;
  try {
    await new Promise<void>((res, rej) => {
      video.onloadeddata = () => res();
      video.onerror = () => rej(new Error('clip could not be decoded'));
    });
    video.playbackRate = rate;
    let last = -Infinity;
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      video.onended = finish;
      const onVideoFrame = async (_now: number, meta: VideoFrameCallbackMetadata) => {
        const t = meta.mediaTime * 1000;
        if (t - last >= 1000 / fps - 2) {
          last = t;
          try {
            const bmp = await createImageBitmap(video, { resizeWidth: FRAME_W, resizeHeight: FRAME_H });
            const accepted = await onFrame(Math.round(t), bmp);
            if (accepted) sent++;
          } catch {
            /* a frame that could not be captured is simply skipped */
          }
          if (sent >= maxFrames) {
            video.pause();
            return finish();
          }
        }
        if (!video.ended) video.requestVideoFrameCallback(onVideoFrame);
      };
      video.requestVideoFrameCallback(onVideoFrame);
      void video.play().catch(finish);
    });
  } finally {
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
  return sent;
}

async function analyse(p: Programme, clip: Clip, setup: CameraSetup, log: CueLogEntry[], scenarios?: DefenderScenario[]): Promise<void> {
  const settings = await db.settings.get('main');
  const pose = settings?.camera.pose ?? 'off';
  const fps = settings?.camera.analysisFps ?? 15;
  const kind = KIND[setup.drillFamily] ?? 'feint';
  const worker = newWorker();
  let inFlight = 0;
  let wake: (() => void) | null = null;
  const result = new Promise<Extract<FromWorker, { type: 'result' }>>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === 'ack') {
        inFlight--;
        wake?.();
      } else if (m.type === 'result') resolve(m);
      else if (m.type === 'error') reject(new Error(m.message));
    };
  });
  const ready = new Promise<void>((resolve) => {
    const prev = worker.onmessage;
    worker.onmessage = (ev) => {
      if ((ev.data as FromWorker).type === 'ready') {
        worker.onmessage = prev;
        resolve();
      } else prev?.call(worker, ev);
    };
  });
  try {
    const bp = settings?.flags?.ballTracking && settings.activeBallProfileId ? await db.ballProfiles.get(settings.activeBallProfileId) : undefined;
    const neural = !!settings?.flags?.ballTracking && !!settings.flags.neuralBallDetector;
    call(worker, {
      type: 'init',
      pose: kind === 'feint' || kind === 'scan' ? pose : 'off',
      wasmBase: wasmBase(),
      zones: [...setup.zones],
      ball: bp || neural ? { profileId: bp?.id ?? 'model-only', colour: bp?.colour, sizeSamples: bp?.sizeSamples ?? [], width: bp?.frameWidth ?? 320, neural } : undefined,
    });
    await ready;
    // With pose, play at normal speed; zone and motion work alone keeps up at double speed.
    const rate = pose === 'off' ? 2 : 1;
    await playFrames(clip.blob, fps, rate, async (tMs, bmp) => {
      if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => (wake = r));
      inFlight++;
      call(worker, { type: 'frame', tMs: tMs + clip.startActiveMs, bitmap: bmp }, [bmp]);
      return true;
    });
    const gateZones = setup.zones.slice(1).map((z) => z.name);
    call(worker, {
      type: 'finish',
      log,
      ctx: { kind, mirror: setup.mirror, homography: setup.homography, blockEndMs: clip.durationS * 1000 + clip.startActiveMs, fps, alignmentErrorMs: settings?.timingBudget?.alignmentErrorMs },
      gateZones,
    });
    const { reps, block: b0, ball } = await result;
    const block = ball ? { ...b0, ball } : b0;
    await db.transaction('rw', db.repAnalyses, db.blockAnalyses, async () => {
      await db.repAnalyses.bulkPut(reps.map((r) => ({ id: `${clip.id}:${r.repIndex}`, clipId: clip.id, repIndex: r.repIndex, data: r })));
      await db.blockAnalyses.put({ id: clip.id, clipId: clip.id, date: new Date().toISOString(), data: block });
    });
    if (scenarios?.length) await saveFeintReps(clip, scenarios, reps);
    if (kind === 'scan') await saveScanReps(clip, log, reps);
  } finally {
    worker.terminate();
  }
  void p;
}

/** Per-rep feint records from a defender block's analysis (part 16 §10). Camera numbers are estimates until validated. */
async function saveFeintReps(clip: Clip, scenarios: DefenderScenario[], reps: RepAnalysis[]): Promise<void> {
  const rows: FeintRep[] = scenarios.map((s) => {
    const r = reps.find((x) => x.repIndex === s.repIndex);
    const ok = r?.status === 'ok';
    return {
      repId: s.id,
      scenarioId: s.id,
      sessionRecordId: clip.sessionRecordId,
      feintFeatureObservations: [
        { feature: 'fakeShiftHipWidths', value: r?.fakeShiftHipWidths, status: ok && r?.fakeShiftHipWidths !== undefined ? 'estimate' : 'unableToAssess', confidence: r?.confidence },
        { feature: 'exitShiftHipWidths', value: r?.exitShiftHipWidths, status: ok && r?.exitShiftHipWidths !== undefined ? 'estimate' : 'unableToAssess', confidence: r?.confidence },
      ],
      techniqueStatus: ok ? r?.techniqueStatus ?? 'unableToAssess' : 'unableToAssess',
      defenderReaction: s.reaction,
      selectedExit: ok && r?.exitDir ? r.exitDir : undefined,
      finalValidExit: s.correctExit,
      earlyCommitmentEvidence: r?.possibleEarlyRouteCommitment,
      secondCueAdaptation: s.recovery && ok ? r?.decisionCorrect : undefined,
      timeToExitMs: ok && r?.exitMs !== undefined && r.cueTimeMs !== undefined ? r.exitMs - r.cueTimeMs : undefined,
      timingUncertaintyMs: r?.timingUncertaintyMs,
      measureStatuses: {
        correctResponseByDefenderAction: ok && r?.decisionCorrect !== undefined ? 'estimate' : 'unableToAssess',
        controlledExit: 'unableToAssess', // needs ball tracking (part 17)
        timeToAppropriateExitMs: ok && r?.exitMs !== undefined ? 'estimate' : 'unableToAssess',
      },
    };
  });
  await db.feintReps.bulkPut(rows);
}

/** Per-rep scanning records (task 4.2). A head turn is an orientation proxy, not proof of seeing; first-touch control needs ball tracking. */
async function saveScanReps(clip: Clip, log: CueLogEntry[], reps: RepAnalysis[]): Promise<void> {
  const rows: ScanRep[] = log.map((e) => {
    const r = reps.find((x) => x.repIndex === e.rep);
    const ok = r?.status === 'ok';
    return {
      repId: `${clip.id}:${e.rep}`,
      sessionRecordId: clip.sessionRecordId,
      blockIndex: clip.blockIndex,
      cueSequence: [e.value, e.secondValue].filter((x): x is string => !!x),
      cueTimeMs: e.cueMs,
      firstTouchTimeMs: ok ? r?.touchMs : undefined,
      headOrientationBeforeTouch: ok && r?.looksBeforeTouch !== undefined ? (r.looksBeforeTouch > 0 ? 'toward' : 'away') : 'unknown',
      scanProxyStatus: ok && r?.looksBeforeTouch !== undefined ? 'estimate' : 'unableToAssess',
      selectedChannel: ok ? r?.zoneEvents.find((z) => z.tMs >= (e.cueMs ?? 0))?.zone : undefined,
      correctDecision: ok ? r?.decisionCorrect : undefined,
      controlledFirstTouch: undefined,
      cueAvailabilityCondition: e.hidden ? 'noInformation' : 'visible',
      scanMode: e.secondValue ? 'secondChange' : 'stationarySimulation',
      observations: [
        { metric: 'scanBeforeReceiveObserved', status: ok && r?.looksBeforeTouch !== undefined ? 'estimate' : 'unableToAssess', confidence: r?.confidence },
        { metric: 'firstTouchCorrect', status: ok && r?.decisionCorrect !== undefined ? 'estimate' : 'unableToAssess', confidence: r?.confidence },
        { metric: 'firstTouchControlled', status: 'unableToAssess' },
        { metric: 'scanToActionSuccess', status: 'unableToAssess' }, // only when every constituent is assessed
      ],
    };
  });
  await db.scanReps.bulkPut(rows);
}

/** Queues the analysis of a recorded cue or defender block. Other blocks are recorded for replay only. */
export function analyseClip(p: Programme, clip: Clip, _block: RunBlock, setup: CameraSetup, log: CueLogEntry[] | undefined, scenarios?: DefenderScenario[]): Promise<unknown> {
  const reps = scenarios?.length ? scenariosToLog(scenarios) : log;
  if (!reps?.length) return Promise.resolve();
  queue = queue.then(() => analyse(p, clip, setup, reps, scenarios)).catch((e) => console.warn('analysis failed', e));
  return queue;
}
