import type { BlockAnalysis, RepAnalysis } from '../analysis/types';
import type { Programme } from '../content/types';
import type { CueLogEntry } from '../cue/engine';
import type { BlockResult, DefenderScenario, FeatureFlags } from '../db/types';
import type { RunBlock, RunPlan } from './plans';
import { SMOOTH_FPS } from '../defender/fps';

// Parent → System test: every feature once, the drills grouped by cone layout (content
// systemTest), then a report per block: did each feature work, and if not, the likely reasons,
// from the block's own results and from the recorded footage. Never counts, never unlocks.

export const CHECK_IDS = [
  'recording',
  'presence',
  'analysis',
  'cueEngine',
  'tripwire',
  'wallBang',
  'looks',
  'decision',
  'defender3d',
  'feintDetector',
  'ballTracking',
  'gateEvents',
  'vPulls',
  'rapidTouches',
  'slalom',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export const CHECK_LABELS: Record<CheckId, string> = {
  recording: 'Camera recorded the block',
  presence: 'Player seen in the drill area',
  analysis: 'After-block camera analysis',
  cueEngine: 'Cues shown',
  tripwire: 'Tripwire triggered the cues',
  wallBang: 'Ball hitting the wall triggered the cues (microphone)',
  looks: 'Looks (head turns) seen',
  decision: 'Which way the player went (decision read)',
  defender3d: '3D defender shown',
  feintDetector: 'Feint detector triggered the defender',
  ballTracking: 'Ball followed by the camera',
  gateEvents: 'Ball seen crossing the gates',
  vPulls: 'V-pulls counted',
  rapidTouches: 'Rapid touches counted (experimental)',
  slalom: 'Slalom run timed',
};

/** Feature switches the test turns on (and puts back afterwards). Notifications stay as they are:
 *  they send data off the device and the test has nothing to send. */
export const TEST_FLAGS: (keyof FeatureFlags)[] = ['defender3d', 'realisticDefender', 'liveOnsetDetector', 'ballTracking', 'rapidTouches', 'learning', 'coneDetection', 'neuralBallDetector'];

export function systemTestPlan(p: Programme): RunPlan | null {
  const st = p.systemTest;
  if (!st?.blocks.length) return null;
  const blocks: RunBlock[] = st.blocks.map((b) => {
    const d = p.drills.find((x) => x.id === b.drillId);
    return { kind: 'work', minutes: b.minutes, mode: d?.mode ?? 'timed', areaId: d?.areaId, drillId: b.drillId, params: 'system test' };
  });
  return { title: st.title, parts: [{ kind: 'systemTest' }], blocks, totalMinutes: blocks.reduce((t, b) => t + b.minutes, 0), light: false, partner: false };
}

/** How many times the cones are moved: one set-up per change of layout. */
export function coneMoves(p: Programme): number {
  const ids = p.systemTest?.blocks.map((b) => b.layoutId) ?? [];
  return ids.filter((id, i) => i > 0 && id !== ids[i - 1]).length;
}

// ---------- Footage ----------

/** Simple picture statistics from frames sampled out of the block's clip. */
export interface FootageStats {
  frames: number;
  /** Mean brightness 0..255. */
  meanLuma: number;
  /** Share of pixels near black / near white. */
  darkShare: number;
  brightShare: number;
  /** Edge strength (variance of the Laplacian on a small grey frame): low = blurred or out of focus. */
  sharpness: number;
  /** Mean change between consecutive sampled frames (0..255): near zero = nobody moving in view. */
  motion: number;
  /** Share of the movement in the frame's outer border: high = the action is at the edge or out of view. */
  edgeMotionShare: number;
}

/** Statistics from grey frames (one luma byte per pixel, all the same size). */
export function footageStats(frames: Uint8Array[], width: number, height: number): FootageStats {
  const n = frames.length;
  if (!n) return { frames: 0, meanLuma: 0, darkShare: 0, brightShare: 0, sharpness: 0, motion: 0, edgeMotionShare: 0 };
  let sum = 0;
  let dark = 0;
  let bright = 0;
  let sharp = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) {
      sum += f[i];
      if (f[i] < 25) dark++;
      else if (f[i] > 245) bright++;
    }
    // Laplacian variance.
    let s1 = 0;
    let s2 = 0;
    let k = 0;
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const l = 4 * f[i] - f[i - 1] - f[i + 1] - f[i - width] - f[i + width];
        s1 += l;
        s2 += l * l;
        k++;
      }
    sharp += k ? s2 / k - (s1 / k) ** 2 : 0;
  }
  const px = n * width * height;
  let edge = 0;
  let all = 0;
  const bw = Math.max(1, Math.round(width * 0.1));
  const bh = Math.max(1, Math.round(height * 0.1));
  for (let j = 1; j < n; j++) {
    const a = frames[j - 1];
    const b = frames[j];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const d = Math.abs(a[y * width + x] - b[y * width + x]);
        all += d;
        if (x < bw || x >= width - bw || y < bh || y >= height - bh) edge += d;
      }
  }
  return {
    frames: n,
    meanLuma: Math.round(sum / px),
    darkShare: round2(dark / px),
    brightShare: round2(bright / px),
    sharpness: Math.round(sharp / n),
    motion: n > 1 ? round2(all / ((n - 1) * width * height)) : 0,
    edgeMotionShare: all ? round2(edge / all) : 0,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Thresholds for the footage reasons. Heuristics for a parent to check, not measurements. */
export const FOOTAGE = { dark: 60, darkShare: 0.35, brightShare: 0.2, blur: 40, still: 1.5, edgeMotion: 0.45 };

/** Likely picture problems, plain words for the parent. */
export function footageReasons(f: FootageStats | undefined): string[] {
  if (!f || !f.frames) return [];
  const out: string[] = [];
  if (f.meanLuma < FOOTAGE.dark || f.darkShare > FOOTAGE.darkShare) out.push(`The picture is dark (brightness ${f.meanLuma} of 255): turn on more lights or open the curtains.`);
  if (f.brightShare > FOOTAGE.brightShare) out.push(`Part of the picture is washed out (${Math.round(f.brightShare * 100)}% near white): a window or lamp behind the player; turn the camera away from it or close the blind.`);
  if (f.sharpness < FOOTAGE.blur) out.push('The picture is soft or blurred: wipe the lens, check the focus, or add light so the camera can use a faster shutter.');
  if (f.motion < FOOTAGE.still) out.push('Hardly any movement in the picture: the player may have been out of view, or the camera pointed away from the drill area.');
  else if (f.edgeMotionShare > FOOTAGE.edgeMotion) out.push('Most of the movement is at the edge of the picture: move the camera back or turn it so the drill area is in the middle.');
  return out;
}

// ---------- Checks ----------

export type CheckResult = 'pass' | 'partial' | 'fail' | 'notRun' | 'pending';

export interface CheckOutcome {
  id: CheckId;
  label: string;
  result: CheckResult;
  detail: string;
  reasons: string[];
}

/** Everything known about one block of the test. */
export interface BlockEvidence {
  block?: BlockResult;
  hasClip: boolean;
  footage?: FootageStats;
  analysis?: BlockAnalysis;
  /** The clip was saved with a camera set-up, so the analysis should come. */
  analysisExpected: boolean;
  reps: RepAnalysis[];
  scenarios: DefenderScenario[];
  ctx: {
    cameraOn: boolean;
    setup: boolean;
    setupTripwire: boolean;
    setupGates: boolean;
    setupSquare: boolean;
    pose: 'off' | 'lite' | 'full';
    analysisFps: number;
    flags: Partial<FeatureFlags>;
    webgl?: boolean;
    defenderFps?: number;
    ballProfile: boolean;
    /** Share of room pixels the registered ball's colour also matches. */
    ballBackgroundShare?: number;
    wallUsable: boolean;
    wallMic: boolean;
    roomCheck?: string;
  };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const grade = (share: number, good = 0.7, some = 0.3): CheckResult => (share >= good ? 'pass' : share >= some ? 'partial' : 'fail');

/** Common camera reasons for any camera-read measure. */
function cameraReasons(e: BlockEvidence): string[] {
  const r: string[] = [];
  if (!e.ctx.cameraOn) r.push('Recording is off in the app (Parent → Camera set-up → Camera on).');
  else if (!e.hasClip) r.push('The camera did not record this block (another app or tab may have had the camera, or Chrome blocked it).');
  if (e.hasClip && !e.ctx.setup) r.push("This layout has no camera set-up (Parent → Camera set-up): the drill area and lines are not marked, so the camera can't measure anything.");
  if (e.ctx.roomCheck === 'moved') r.push('The camera had moved since the room profile photo: put it back where it was, or redo the camera set-up.');
  r.push(...footageReasons(e.footage));
  return r;
}

function topFlags(reps: RepAnalysis[]): string[] {
  const n = new Map<string, number>();
  for (const r of reps) for (const f of r.flags) n.set(f, (n.get(f) ?? 0) + 1);
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([f, k]) => `${k} of ${reps.length} reps: "${f}"${FLAG_HINT[f] ? ` (${FLAG_HINT[f]})` : ''}.`);
}

const FLAG_HINT: Record<string, string> = {
  'body lost': 'the camera lost the body: too far, cut off at the edge, or too dark',
  'no exit seen': 'no move out of the middle was seen: the exit may be out of view',
  'no clear lateral exit': 'the move sideways was small or out of view',
  'tripwire not crossed': 'the start line was not crossed where it is drawn',
  'gate and hips disagree': 'the ball and the body went different ways, or a gate is drawn in the wrong place',
  'no movement after the cue': 'nothing moved after the cue, or the player was out of view',
  'no frames before the cue': 'the recording started late or frames were dropped',
};

function poseReasons(e: BlockEvidence): string[] {
  const r: string[] = [];
  if (e.ctx.pose === 'off') r.push('Body tracking (pose) is off: run Parent → Pose speed test so the analysis can use it.');
  if (e.analysis && !e.analysis.poseUsed) r.push('The analysis ran without body tracking, so looks and body direction could not be read.');
  if (e.analysis && e.analysis.analysedFps > 0 && e.analysis.analysedFps < 10) r.push(`The analysis only ran at ${e.analysis.analysedFps} frames a second: quick moves can fall between frames.`);
  return r;
}

const out = (id: CheckId, result: CheckResult, detail: string, reasons: string[] = []): CheckOutcome => ({ id, label: CHECK_LABELS[id], result, detail, reasons: result === 'pass' ? [] : [...new Set(reasons)] });

const cueEntries = (log: CueLogEntry[] | undefined) => (log ?? []).filter((x) => x.cueMs !== undefined);

export function evaluateCheck(id: CheckId, e: BlockEvidence): CheckOutcome {
  const b = e.block;
  if (!b || b.skipped) return out(id, 'notRun', 'The block was skipped or not reached.');
  const a = e.analysis;
  const pendingAnalysis = !a && e.analysisExpected;
  switch (id) {
    case 'recording':
      return e.hasClip ? out(id, 'pass', 'A clip was saved.') : out(id, 'fail', 'No clip was saved.', cameraReasons(e));
    case 'presence': {
      if (b.presenceFrac === undefined) return out(id, 'fail', 'Presence was not measured.', [...cameraReasons(e), 'Presence needs the drill area marked in the camera set-up and at least a few seconds of recording.']);
      return out(id, grade(b.presenceFrac), `In the drill area ${pct(b.presenceFrac, 1)}% of the time.`, [...cameraReasons(e), 'The drill area drawn in the camera set-up may not match where the cones are now.']);
    }
    case 'analysis': {
      if (pendingAnalysis) return out(id, 'pending', 'Still checking the recording…');
      if (!a) return out(id, 'fail', 'No analysis.', cameraReasons(e));
      if (!a.reps) return out(id, a.slalom?.length || a.vPulls?.length || a.ball ? 'pass' : 'partial', 'Analysis ran (no cued reps in this drill).', cameraReasons(e));
      return out(id, grade(a.validReps / a.reps, 0.6, 0.2), `${a.validReps} of ${a.reps} reps could be read.`, [...topFlags(e.reps), ...poseReasons(e), ...cameraReasons(e)]);
    }
    case 'cueEngine': {
      const shown = cueEntries(b.cueLog);
      return shown.length ? out(id, 'pass', `${shown.length} cues shown.`) : out(id, 'fail', 'No cues were shown.', ['The drill ran without the cue engine: check Parent → Cue drills for this drill.']);
    }
    case 'tripwire': {
      const reps = (b.cueLog ?? []).filter((x) => x.trigger === 'tripwire' || x.trigger === 'timed');
      const hit = reps.filter((x) => x.trigger === 'tripwire' && !x.missedTripwire).length;
      const why = [
        ...(!e.ctx.setupTripwire ? ['No tripwire (start line) is drawn in the camera set-up for this layout, so cues ran on a timer.'] : []),
        ...(!e.ctx.cameraOn ? ['Recording is off, so the tripwire cannot run.'] : []),
        'The player may start the rep away from the drawn line, or step over it before the camera is watching.',
        ...cameraReasons(e),
      ];
      if (!reps.length) return out(id, 'fail', 'No reps used the tripwire.', why);
      return out(id, grade(hit / reps.length), `${hit} of ${reps.length} reps triggered by the tripwire; the rest on a timer.`, why);
    }
    case 'wallBang': {
      const reps = (b.cueLog ?? []).filter((x) => x.trigger === 'sound');
      const heard = reps.filter((x) => !x.noBang).length;
      if (!reps.length)
        return out(id, 'fail', 'The cues did not wait for the wall.', [
          ...(!e.ctx.wallUsable ? ['The room profile says the back wall cannot be used (Parent → Room profiles: "Back wall can be used").'] : []),
          ...(!e.ctx.wallMic ? ['Listening for the wall is off (Parent → Settings → wall microphone).'] : []),
          'Chrome may have been refused the microphone: allow it in the address-bar camera/microphone icon.',
        ]);
      return out(id, grade(heard / reps.length), `The bang was heard on ${heard} of ${reps.length} reps; the rest showed the cue on its own.`, [
        'A soft pass may be too quiet: kick firmly at the wall.',
        'The Chromebook may be far from the wall, or a fan, TV or the app’s own voice was louder than the bang: turn the room noise down.',
      ]);
    }
    case 'looks': {
      if (pendingAnalysis) return out(id, 'pending', 'Still checking the recording…');
      const seen = e.reps.filter((r) => r.looksBeforeTouch !== undefined).length;
      if (!e.reps.length) return out(id, 'fail', 'No reps were read.', [...poseReasons(e), ...cameraReasons(e)]);
      return out(id, grade(seen / e.reps.length), `Looks could be read on ${seen} of ${e.reps.length} reps.`, [
        ...poseReasons(e),
        'The head and shoulders must be in view and not too small: the camera at chest height, the player facing it, the whole body in the picture.',
        ...topFlags(e.reps),
        ...cameraReasons(e),
      ]);
    }
    case 'decision': {
      if (pendingAnalysis) return out(id, 'pending', 'Still checking the recording…');
      const read = e.reps.filter((r) => r.decisionCorrect !== undefined).length;
      if (!e.reps.length) return out(id, 'fail', 'No reps were read.', [...poseReasons(e), ...cameraReasons(e)]);
      return out(id, grade(read / e.reps.length), `Which way the player went was read on ${read} of ${e.reps.length} reps.`, [...topFlags(e.reps), 'The exits left and right must stay inside the picture.', ...poseReasons(e), ...cameraReasons(e)]);
    }
    case 'defender3d': {
      const d = b.defender;
      const why = [
        ...(!e.ctx.flags.defender3d ? ['The 3D defender is switched off (Parent → Settings → Features).'] : []),
        ...(e.ctx.webgl === false ? ['This Chromebook reported no WebGL, so the arrow fallback is used.'] : []),
      ];
      if (!d) return out(id, 'fail', 'The block ran without the defender.', why);
      // No WebGL at all gives the arrow fallback; a switch mid-block (slow, GPU reset) gives the 2D fallback.
      if (d.view !== 'player3d') return out(id, 'fail', `${e.ctx.webgl === false ? 'The arrow fallback' : 'The 2D fallback'} was used${d.fallbackReason ? `: ${d.fallbackReason}` : ''}.`, why);
      const slow = e.ctx.defenderFps !== undefined && e.ctx.defenderFps < SMOOTH_FPS;
      return out(id, slow ? 'partial' : 'pass', `3D defender shown (${d.reps} reps${e.ctx.defenderFps ? `, ${e.ctx.defenderFps} frames a second in the defender test` : ''}).`, slow ? [`The defender test measured under ${SMOOTH_FPS} frames a second: close other tabs, or turn off the realistic defender.`] : []);
    }
    case 'feintDetector': {
      const sc = e.scenarios;
      if (!sc.length) return out(id, 'fail', 'No defender reps were logged.', ['The block ran without the 3D defender (see that check).']);
      const cam = sc.filter((x) => x.triggerSource === 'cameraOnset').length;
      const fakes = sc.filter((x) => x.feintDirection).length;
      const why = [
        ...(!e.ctx.flags.liveOnsetDetector ? ['The live feint detector is switched off (Parent → Settings → Features), so the defender moved on planned timing.'] : []),
        ...(!e.ctx.cameraOn ? ['Recording is off, so the detector has no picture.'] : []),
        ...(!e.ctx.setup ? ['This layout has no camera set-up, so the detector does not know where the lane is.'] : []),
        'The fake may have been small or slow: the detector needs a clear shift of the hips to one side.',
        'The hips must be in view and well lit, and the player should face the camera when faking.',
        ...cameraReasons(e),
      ];
      return out(id, grade(cam / sc.length), `The camera triggered the defender on ${cam} of ${sc.length} reps (fake direction seen on ${fakes}); the rest used planned timing.`, why);
    }
    case 'ballTracking': {
      if (pendingAnalysis) return out(id, 'pending', 'Still checking the recording…');
      const why = [
        ...(!e.ctx.flags.ballTracking ? ['Ball tracking is switched off (Parent → Settings → Features).'] : []),
        ...(!e.ctx.ballProfile ? ['No ball is registered (Parent → Balls).'] : []),
        ...(e.ctx.ballBackgroundShare !== undefined && e.ctx.ballBackgroundShare > 0.05 ? [`The registered ball's colour also matches ${Math.round(e.ctx.ballBackgroundShare * 100)}% of the room: a brighter, one-colour ball works better (Parent → Balls → ball check).`] : []),
        'The ball may have been registered in different light: register it again in today’s light.',
        ...cameraReasons(e),
      ];
      const ball = a?.ball;
      if (!ball || ball.status === 'unableToAssess') return out(id, 'fail', 'The ball was not followed.', why);
      return out(id, grade(ball.seenShare, 0.5, 0.2), `Ball seen in ${pct(ball.seenShare, 1)}% of frames (${ball.touches.confirmed} touches confirmed, ${ball.touches.possible} possible).`, why);
    }
    case 'gateEvents': {
      if (pendingAnalysis) return out(id, 'pending', 'Still checking the recording…');
      const n = a?.ball?.gateEvents.length ?? 0;
      const why = [...(!e.ctx.setupGates ? ['No gates are drawn in the camera set-up for this layout.'] : []), 'The ball must be seen as it crosses: see the ball tracking check.'];
      return n ? out(id, 'pass', `${n} gate crossings seen.`) : out(id, 'fail', 'No gate crossings seen.', why);
    }
    case 'vPulls': {
      if (pendingAnalysis) return out(id, 'pending', 'Still checking the recording…');
      const w = a?.vPulls ?? [];
      const ok = w.filter((x) => x.status !== 'unableToAssess').length;
      if (!w.length) return out(id, 'fail', 'No V-pull windows were analysed.', ['V-pulls are counted inside the timed windows of the mastery set: let the block run through them.', ...cameraReasons(e)]);
      return out(id, grade(ok / w.length), `${ok} of ${w.length} V-pull windows counted.`, [...w.flatMap((x) => (x.reason ? [x.reason + '.'] : [])), ...(!e.ctx.setupSquare ? ['No square is marked in the camera set-up.'] : []), ...cameraReasons(e)]);
    }
    case 'rapidTouches': {
      if (pendingAnalysis) return out(id, 'pending', 'Still checking the recording…');
      const w = a?.taps ?? [];
      const ok = w.filter((x) => x.status !== 'unobservable').length;
      if (!w.length) return out(id, 'fail', 'No rapid-touch windows were analysed.', [...(!e.ctx.flags.rapidTouches ? ['Rapid touches are switched off (Parent → Settings → Features).'] : []), ...cameraReasons(e)]);
      return out(id, grade(ok / w.length), `${ok} of ${w.length} windows counted.`, [...w.flatMap((x) => (x.reason ? [x.reason + '.'] : [])), ...cameraReasons(e)]);
    }
    case 'slalom': {
      if (pendingAnalysis) return out(id, 'pending', 'Still checking the recording…');
      const runs = a?.slalom ?? [];
      const ok = runs.filter((x) => x.status !== 'unableToAssess').length;
      if (!runs.length) return out(id, 'fail', 'No slalom runs were analysed.', ['The runs are timed from the start tone: let the block run its timed runs.', ...cameraReasons(e)]);
      return out(id, grade(ok / runs.length), `${ok} of ${runs.length} runs timed.`, [...runs.flatMap((x) => (x.reason ? [x.reason + ' (is the stop zone drawn where the run ends?).'] : [])), ...cameraReasons(e)]);
    }
  }
}

export function evaluateBlock(checks: string[], e: BlockEvidence): CheckOutcome[] {
  return checks.filter((c): c is CheckId => (CHECK_IDS as readonly string[]).includes(c)).map((c) => evaluateCheck(c, e));
}
