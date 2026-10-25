import type { CueLogEntry, Side } from '../cue/engine';
import type { BlockAnalysis, RepAnalysis, ZoneEvent } from './types';

// After-block analysis (plan/08 §8.4, plan/12): pure functions over per-frame
// measurements. The worker fills FrameData; these turn it into rep and block numbers.
// Below its confidence threshold a rep is unableToAssess and left out of block statistics.

/** A few pose landmarks in picture coordinates (0..1), with visibility. */
export interface PosePoint {
  x: number;
  y: number;
  v: number;
}
export interface Pose {
  nose: PosePoint;
  lEye: PosePoint;
  rEye: PosePoint;
  lShoulder: PosePoint;
  rShoulder: PosePoint;
  lHip: PosePoint;
  rHip: PosePoint;
  lAnkle: PosePoint;
  rAnkle: PosePoint;
}

export interface FrameData {
  tMs: number; // active block time
  area: number; // motion fraction in the drill area
  zones: Record<string, number>; // motion fraction per zone
  pose?: Pose | null;
}

export type DrillKind = 'feint' | 'scan' | 'slalom' | 'control';

export interface AnalysisContext {
  kind: DrillKind;
  mirror: boolean; // picture mirrored: picture left = her left
  homography?: number[];
  blockEndMs: number;
  fps: number;
  /** Measured camera-to-render clock alignment error (task 3.1), when known. */
  alignmentErrorMs?: number;
  /** Thresholds from active personalised models (part 18); absent = the base rules. */
  thresholds?: Partial<Pick<typeof THRESHOLDS, 'fakeMinHipWidths' | 'lookShoulderWidths'>>;
}

export const THRESHOLDS = {
  zoneEnter: 0.12, // share of a zone's cells changing = something entered it
  zoneFrames: 2, // for this many frames in a row
  onsetSd: 3, // reaction onset: motion above pre-cue mean + 3 sd
  movingBeforeCue: 0.05, // pre-cue motion this high = cannot time an onset
  exitShiftHipWidths: 0.25, // lateral hip shift that counts as the exit
  lookShoulderWidths: 0.35, // nose this far from the shoulder centre = head turned
  lookMinMs: 100,
  preCommitMs: 200, // legacy only
  perceptionMinMs: 100, // a response this soon after the defender moved cannot be a read of it
  fakeMinHipWidths: 0.12, // lateral hip shift against the exit, before it, that counts as an observed fake
  confidenceMin: 0.6,
  maxGapFrames: 5,
  minValidReps: 8,
};

const vis = (p: PosePoint | undefined) => !!p && p.v >= 0.5;
const mid = (a: PosePoint, b: PosePoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Her side for a picture-x direction: picture right = her left unless the picture is mirrored. */
export const herSide = (pictureDx: number, mirror: boolean): Side => (pictureDx > 0 ? (mirror ? 'right' : 'left') : mirror ? 'left' : 'right');

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Least-squares slope of y on x, with its standard error. */
export function slope(xs: number[], ys: number[]): { slope: number; se: number } | undefined {
  const n = xs.length;
  if (n < 3) return undefined;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return undefined;
  const b = sxy / sxx;
  const a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (a + b * xs[i])) ** 2;
  return { slope: b, se: Math.sqrt(sse / (n - 2) / sxx) };
}

/** Zone events: the first frame of each run of ≥ zoneFrames frames above the entry threshold. */
export function zoneEvents(frames: FrameData[], zones: string[]): ZoneEvent[] {
  const out: ZoneEvent[] = [];
  for (const z of zones) {
    let run = 0;
    let start = 0;
    let armed = true;
    for (const f of frames) {
      const over = (f.zones[z] ?? 0) > THRESHOLDS.zoneEnter;
      if (over) {
        if (run === 0) start = f.tMs;
        run++;
        if (run === THRESHOLDS.zoneFrames && armed) {
          out.push({ zone: z, tMs: start });
          armed = false;
        }
      } else {
        run = 0;
        armed = true;
      }
    }
  }
  return out.sort((a, b) => a.tMs - b.tMs);
}

/** Reaction onset: first frame after the cue whose area motion rises above the pre-cue level. */
export function reactionOnset(frames: FrameData[], cueMs: number): { onsetMs?: number; reason?: string } {
  const pre = frames.filter((f) => f.tMs >= cueMs - 500 && f.tMs < cueMs).map((f) => f.area);
  if (pre.length < 3) return { reason: 'no frames before the cue' };
  const mean = pre.reduce((a, b) => a + b, 0) / pre.length;
  const sd = Math.sqrt(pre.reduce((a, b) => a + (b - mean) ** 2, 0) / pre.length);
  if (mean > THRESHOLDS.movingBeforeCue) return { reason: 'moving before the cue' };
  const level = Math.max(mean + THRESHOLDS.onsetSd * sd, mean + 0.01);
  const hit = frames.find((f) => f.tMs >= cueMs && f.tMs <= cueMs + 2000 && f.area > level);
  return hit ? { onsetMs: hit.tMs } : { reason: 'no movement after the cue' };
}

function poseCoverage(frames: FrameData[], need: (p: Pose) => boolean): { coverage: number; maxGap: number } {
  let ok = 0;
  let gap = 0;
  let maxGap = 0;
  for (const f of frames) {
    if (f.pose && need(f.pose)) {
      ok++;
      gap = 0;
    } else {
      gap++;
      maxGap = Math.max(maxGap, gap);
    }
  }
  return { coverage: frames.length ? ok / frames.length : 0, maxGap };
}

const hipsVisible = (p: Pose) => vis(p.lHip) && vis(p.rHip);
const shouldersVisible = (p: Pose) => vis(p.lShoulder) && vis(p.rShoulder);

/** Exit from the hip midpoint track: the side she ends up on and when the movement toward it began. */
export function exitFromHips(frames: FrameData[], cueMs: number, mirror: boolean): { exitMs?: number; exitDir?: Side; reason?: string } {
  const win = frames.filter((f) => f.tMs >= cueMs - 300 && f.tMs <= cueMs + 1500 && f.pose && hipsVisible(f.pose));
  if (win.length < 6) return { reason: 'hips not seen' };
  const xs = win.map((f) => mid(f.pose!.lHip, f.pose!.rHip).x);
  const widths = win.map((f) => Math.abs(f.pose!.lHip.x - f.pose!.rHip.x));
  const hipW = median(widths) ?? 0.05;
  const atCue = win.findIndex((f) => f.tMs >= cueMs);
  const x0 = xs[Math.max(0, atCue)];
  const dx = xs[xs.length - 1] - x0;
  if (Math.abs(dx) < THRESHOLDS.exitShiftHipWidths * hipW) return { reason: 'no clear lateral exit' };
  const dir = Math.sign(dx);
  // Exit time: the start of the final run of movement toward the exit side (the hip reversal after any feint).
  let i = xs.length - 1;
  while (i > Math.max(0, atCue) && (xs[i] - xs[i - 1]) * dir >= 0) i--;
  return { exitMs: win[i].tMs, exitDir: herSide(dx, mirror) };
}

/** Head up at the exit: nose above the shoulder line and both eyes visible in most exit frames. */
export function headUpAt(frames: FrameData[], tMs: number): boolean | undefined {
  const win = frames.filter((f) => Math.abs(f.tMs - tMs) <= 200 && f.pose && shouldersVisible(f.pose));
  if (win.length < 3) return undefined;
  const up = win.filter((f) => {
    const p = f.pose!;
    const sw = Math.abs(p.lShoulder.x - p.rShoulder.x) || 0.05;
    const shoulderY = (p.lShoulder.y + p.rShoulder.y) / 2;
    return vis(p.lEye) && vis(p.rEye) && shoulderY - p.nose.y > 0.5 * sw;
  }).length;
  return up / win.length >= 0.5;
}

/** Looks over the shoulder: nose off the shoulder centre by ≥ 0.35 shoulder widths for ≥ 100 ms. */
export function looks(frames: FrameData[], fromMs: number, toMs: number, lookShoulderWidths: number = THRESHOLDS.lookShoulderWidths): { count: number; lastEndMs?: number } {
  let count = 0;
  let start: number | null = null;
  let lastEndMs: number | undefined;
  for (const f of frames) {
    if (f.tMs < fromMs || f.tMs > toMs) continue;
    const p = f.pose;
    let turned = false;
    if (p && shouldersVisible(p)) {
      const sw = Math.abs(p.lShoulder.x - p.rShoulder.x) || 0.05;
      turned = Math.abs(p.nose.x - (p.lShoulder.x + p.rShoulder.x) / 2) / sw >= lookShoulderWidths;
    }
    if (turned && start === null) start = f.tMs;
    if (!turned && start !== null) {
      if (f.tMs - start >= THRESHOLDS.lookMinMs) {
        count++;
        lastEndMs = f.tMs;
      }
      start = null;
    }
  }
  if (start !== null && toMs - start >= THRESHOLDS.lookMinMs) {
    count++;
    lastEndMs = toMs;
  }
  return { count, lastEndMs };
}

/** The largest head turn (nose offset from the shoulder centre, in shoulder widths) held for the look's minimum time. */
export function maxHeadTurn(frames: FrameData[], fromMs: number, toMs: number): number | undefined {
  const pts = frames
    .filter((f) => f.tMs >= fromMs && f.tMs <= toMs && f.pose && shouldersVisible(f.pose))
    .map((f) => {
      const p = f.pose!;
      const sw = Math.abs(p.lShoulder.x - p.rShoulder.x) || 0.05;
      return { t: f.tMs, v: Math.abs(p.nose.x - (p.lShoulder.x + p.rShoulder.x) / 2) / sw };
    });
  if (pts.length < 2) return undefined;
  let best = 0;
  for (let i = 0; i < pts.length; i++) {
    if (pts[pts.length - 1].t - pts[i].t < THRESHOLDS.lookMinMs) break;
    // The lowest value over the look's minimum time from here: a turn held that long.
    let lo = Infinity;
    for (let j = i; j < pts.length && pts[j].t - pts[i].t <= THRESHOLDS.lookMinMs; j++) lo = Math.min(lo, pts[j].v);
    best = Math.max(best, lo);
  }
  return Math.round(best * 100) / 100;
}

/** Fake and exit as hip shifts (hip widths) around the exit time; the sequence is observed when both are seen. */
export function feintFeatures(frames: FrameData[], fromMs: number, exitMs: number | undefined, exitDir: Side | undefined, mirror: boolean, fakeMin: number = THRESHOLDS.fakeMinHipWidths): { status: 'observedExecution' | 'estimatedTechnique' | 'unableToAssess'; fake?: number; exit?: number } {
  const win = frames.filter((f) => f.tMs >= fromMs && f.tMs <= (exitMs ?? fromMs) + 800 && f.pose && hipsVisible(f.pose));
  if (win.length < 6 || exitMs === undefined || !exitDir) return { status: 'unableToAssess' };
  const hipW = median(win.map((f) => Math.abs(f.pose!.lHip.x - f.pose!.rHip.x))) ?? 0.05;
  const x = (f: FrameData) => mid(f.pose!.lHip, f.pose!.rHip).x;
  // Her exit side as a picture direction.
  const exitSign = herSide(1, mirror) === exitDir ? 1 : -1;
  const before = win.filter((f) => f.tMs <= exitMs);
  const after = win.filter((f) => f.tMs >= exitMs);
  if (before.length < 3 || after.length < 3) return { status: 'estimatedTechnique' };
  const x0 = x(before[0]);
  const fakeExtreme = Math.max(...before.map((f) => -exitSign * (x(f) - x0)));
  const exitShift = exitSign * (x(after[after.length - 1]) - x(after[0]));
  const fake = Math.round((100 * fakeExtreme) / hipW) / 100;
  const exit = Math.round((100 * exitShift) / hipW) / 100;
  return { status: fake >= fakeMin ? 'observedExecution' : 'estimatedTechnique', fake, exit };
}

/** Which gate means which side, by the zone names from the camera set-up. */
const gateSide = (zone: string): Side | 'back' | undefined =>
  /her-left/.test(zone) ? 'left' : /her-right/.test(zone) ? 'right' : /back/.test(zone) ? 'back' : undefined;

/** Whether the exit matched the cue, where the gates can show it. Undefined = a person judges. */
export function decision(value: string | undefined, catchType: string | undefined, side: Side | undefined, exit: Side | 'back' | 'none'): boolean | undefined {
  if (catchType === 'noCue') return undefined;
  if (catchType === 'blockedShaping' || (value === 'BLOCKED' && side)) return side ? exit !== side : undefined;
  switch (value) {
    case 'LEFT':
    case 'LEFT FREE':
      return exit === 'left';
    case 'RIGHT':
    case 'RIGHT FREE':
      return exit === 'right';
    case 'BOTH BLOCKED':
      return exit === 'back';
    case 'UP':
      return exit === 'none';
    case 'SECOND':
      // Defender held or recovered: protecting (no gate) is right; a second move then a gate is for a person to judge.
      return exit === 'none' ? true : undefined;
    default:
      return undefined;
  }
}

export function analyseReps(frames: FrameData[], log: CueLogEntry[], ctx: AnalysisContext, gateZones: string[]): RepAnalysis[] {
  const allEvents = zoneEvents(frames, gateZones);
  return log.map((e, i) => {
    const end = log[i + 1]?.repStartMs ?? ctx.blockEndMs;
    const repFrames = frames.filter((f) => f.tMs >= e.repStartMs && f.tMs < end);
    const flags: string[] = [];
    const r: RepAnalysis = {
      repIndex: e.rep,
      cueTimeMs: e.cueMs,
      cueValue: e.value,
      catchType: e.catchType,
      zoneEvents: allEvents.filter((z) => z.tMs >= e.repStartMs && z.tMs < end),
      confidence: 0,
      flags,
      status: 'ok',
    };
    const expected = (end - e.repStartMs) / 1000 * ctx.fps;
    const frameCover = expected > 0 ? Math.min(1, repFrames.length / expected) : 0;
    const usesPose = ctx.kind === 'feint' || ctx.kind === 'scan';
    const posed = poseCoverage(repFrames, ctx.kind === 'scan' ? shouldersVisible : hipsVisible);
    const anyPose = repFrames.some((f) => f.pose !== undefined);
    const cueAt = e.cueMs ?? (e.catchType === 'noCue' ? e.repStartMs + e.plannedDelayMs : undefined);

    // Gate passage after the cue decides the exit side where gates are marked.
    const gateAfter = r.zoneEvents.find((z) => cueAt !== undefined && z.tMs >= cueAt && gateSide(z.zone));
    const gateExit: Side | 'back' | 'none' = gateAfter ? gateSide(gateAfter.zone)! : 'none';
    if (gateAfter) r.touchMs = gateAfter.tMs;

    if (cueAt !== undefined) {
      const on = reactionOnset(frames, cueAt);
      if (on.onsetMs !== undefined) r.onsetMs = on.onsetMs;
      if (anyPose && ctx.kind === 'feint') {
        const ex = exitFromHips(frames, cueAt, ctx.mirror);
        if (ex.exitMs !== undefined) {
          r.exitMs = ex.exitMs;
          r.exitDir = ex.exitDir;
          r.headUpAtExit = headUpAt(frames, ex.exitMs);
        } else if (ex.reason) flags.push(ex.reason);
      }
      if (gateExit !== 'none' && gateExit !== 'back' && r.exitDir && gateExit !== r.exitDir) flags.push('gate and hips disagree');
      const exitForDecision = gateExit !== 'none' ? gateExit : r.exitDir ?? 'none';
      // No exit seen at all: a person judges it, unless the right answer was to stay out of the gates.
      const needsExit = e.value !== 'UP' && e.catchType !== 'blockedShaping' && !(e.value === 'BLOCKED' && e.side);
      if (exitForDecision === 'none' && needsExit) flags.push('no exit seen');
      else r.decisionCorrect = decision(e.value, e.catchType, e.side, exitForDecision);
      const d = e as CueLogEntry & { reaction?: string; triggerMs?: number };
      if (d.reaction) {
        r.defenderReaction = d.reaction;
        r.timingUncertaintyMs = Math.round(1000 / ctx.fps + (ctx.alignmentErrorMs ?? 33));
        const ff = feintFeatures(frames, d.triggerMs ?? e.repStartMs, r.exitMs, r.exitDir, ctx.mirror, ctx.thresholds?.fakeMinHipWidths);
        r.techniqueStatus = ff.status;
        r.fakeShiftHipWidths = ff.fake;
        r.exitShiftHipWidths = ff.exit;
        r.preCueMovement = (ff.fake ?? 0) >= (ctx.thresholds?.fakeMinHipWidths ?? THRESHOLDS.fakeMinHipWidths);
        // Evidence, not mind-reading: the final exit run began before the defender's move could have been seen.
        if (r.exitMs !== undefined && e.cueMs !== undefined && r.exitMs + r.timingUncertaintyMs < e.cueMs + THRESHOLDS.perceptionMinMs) {
          r.possibleEarlyRouteCommitment = `final exit movement began ${e.cueMs - r.exitMs} ms before the defender moved (±${r.timingUncertaintyMs} ms)`;
        }
      }
      if (anyPose && ctx.kind === 'scan') {
        const touch = r.touchMs ?? end;
        const lk = looks(frames, e.repStartMs, touch, ctx.thresholds?.lookShoulderWidths);
        r.looksBeforeTouch = lk.count;
        // The largest held head turn before the touch: the personalised scanning model's feature (part 18).
        r.maxHeadTurn = maxHeadTurn(frames, e.repStartMs, touch);
        if (lk.lastEndMs !== undefined && r.touchMs !== undefined) r.lastLookToTouchMs = r.touchMs - lk.lastEndMs;
      }
    } else if (e.missedTripwire) {
      flags.push('tripwire not crossed');
    }

    // Confidence: frames present, and the tracks the numbers need.
    r.confidence = Math.round(100 * (usesPose && anyPose ? Math.min(frameCover, posed.coverage) : frameCover)) / 100;
    if (usesPose && anyPose && posed.maxGap >= THRESHOLDS.maxGapFrames && r.exitMs === undefined && r.looksBeforeTouch === undefined) flags.push('body lost');
    if (r.confidence < THRESHOLDS.confidenceMin || e.missedTripwire) r.status = 'unableToAssess';
    return r;
  });
}

const reactive = (v?: string) => v !== undefined && v !== 'BIT' && v !== 'GO';

export function analyseBlock(reps: RepAnalysis[], meta: { poseUsed: boolean; analysedFps: number; analysisMs: number }): BlockAnalysis {
  const valid = reps.filter((r) => r.status === 'ok');
  const byCue: BlockAnalysis['accuracyByCue'] = {};
  for (const r of valid) {
    if (r.decisionCorrect === undefined) continue;
    const k = r.catchType ? `catch:${r.catchType}` : r.cueValue ?? 'none';
    byCue[k] = byCue[k] ?? { correct: 0, of: 0 };
    byCue[k].of++;
    if (r.decisionCorrect) byCue[k].correct++;
  }
  const decided = valid.filter((r) => r.decisionCorrect !== undefined);
  const timed = valid.filter((r) => r.exitMs !== undefined && r.cueTimeMs !== undefined);
  const blockedShaping = valid.filter((r) => r.catchType === 'blockedShaping' && r.decisionCorrect !== undefined);
  const noCue = valid.filter((r) => r.catchType === 'noCue');
  const reg = slope(
    timed.map((r) => r.cueTimeMs!),
    timed.map((r) => r.exitMs!),
  );
  // Exit quickness relative to matched trials in the same block (part 15 D2): no absolute speed.
  const reactTime = median(timed.filter((r) => reactive(r.cueValue)).map((r) => r.exitMs! - r.cueTimeMs!));
  const simpleTime = median(timed.filter((r) => !reactive(r.cueValue)).map((r) => r.exitMs! - r.cueTimeMs!));
  const heads = valid.filter((r) => r.headUpAtExit !== undefined);
  const looked = valid.filter((r) => r.looksBeforeTouch !== undefined);
  const lastLook = valid.map((r) => r.lastLookToTouchMs).filter((x): x is number => x !== undefined);

  // Defender reps.
  const def = valid.filter((r) => r.defenderReaction);
  const byReaction: Record<string, { correct: number; of: number }> = {};
  for (const r of def) {
    if (r.decisionCorrect === undefined) continue;
    const k = r.defenderReaction!;
    byReaction[k] = byReaction[k] ?? { correct: 0, of: 0 };
    byReaction[k].of++;
    if (r.decisionCorrect) byReaction[k].correct++;
  }
  const changed = def.filter((r) => r.defenderReaction === 'commitThenRecover' && r.decisionCorrect !== undefined);
  const ratios = def.filter((r) => r.techniqueStatus === 'observedExecution' && r.exitShiftHipWidths).map((r) => r.fakeShiftHipWidths! / r.exitShiftHipWidths!);
  const tech = { observedExecution: 0, estimatedTechnique: 0, unableToAssess: 0 };
  for (const r of reps.filter((x) => x.defenderReaction)) tech[r.status === 'ok' ? r.techniqueStatus ?? 'unableToAssess' : 'unableToAssess']++;

  // At most three reps to review: unable to assess first, then disagreements or early-commitment evidence, then wrong decisions.
  const score = (r: RepAnalysis) =>
    r.status === 'unableToAssess' ? 3 : r.flags.includes('gate and hips disagree') || r.possibleEarlyRouteCommitment ? 2 : r.decisionCorrect === false ? 1 : 0;
  const flagged = reps
    .filter((r) => score(r) > 0)
    .sort((a, b) => score(b) - score(a) || a.repIndex - b.repIndex)
    .slice(0, 3)
    .map((r) => r.repIndex);

  const widen = valid.length < THRESHOLDS.minValidReps ? 2 : 1;
  return {
    reps: reps.length,
    validReps: valid.length,
    accuracy: decided.length ? decided.filter((r) => r.decisionCorrect).length / decided.length : undefined,
    accuracyByCue: byCue,
    ranIntoDefenderRate: blockedShaping.length ? blockedShaping.filter((r) => !r.decisionCorrect).length / blockedShaping.length : undefined,
    waitedRate: noCue.length ? noCue.filter((r) => !r.zoneEvents.length && r.exitMs === undefined).length / noCue.length : undefined,
    // Exploratory, and left out below the sample size (part 15 D6).
    reactivitySlope: reg && valid.length >= THRESHOLDS.minValidReps ? reg.slope : undefined,
    reactivityBand: reg && valid.length >= THRESHOLDS.minValidReps ? [reg.slope - 2 * widen * reg.se, reg.slope + 2 * widen * reg.se] : undefined,
    ...(def.length
      ? {
          correctByDefenderAction: byReaction,
          changeOfMind: changed.length ? { correct: changed.filter((r) => r.decisionCorrect).length, of: changed.length } : undefined,
          possibleEarlyRouteCommitments: def.filter((r) => r.possibleEarlyRouteCommitment).length,
          medianTimeToExitMs: median(def.filter((r) => r.exitMs !== undefined && r.cueTimeMs !== undefined && r.decisionCorrect).map((r) => r.exitMs! - r.cueTimeMs!)),
          timingUncertaintyMs: def[0].timingUncertaintyMs,
          technique: tech,
          medianDeceptionRatio: median(ratios),
        }
      : {}),
    exitTimeReactiveVsSimple: reactTime !== undefined && simpleTime ? reactTime / simpleTime : undefined,
    headUpRate: heads.length ? heads.filter((r) => r.headUpAtExit).length / heads.length : undefined,
    looksBeforeTouchRate: looked.length ? looked.filter((r) => (r.looksBeforeTouch ?? 0) > 0).length / looked.length : undefined,
    medianLastLookToTouchMs: median(lastLook),
    flaggedRepIndexes: flagged,
    enoughReps: valid.length >= THRESHOLDS.minValidReps,
    ...meta,
  };
}
