import type { TrackSample } from '../ball/track';
import { pointInPolygon } from '../camera/geometry';
import type { Pt } from '../db/types';
import { zoneEvents, type FrameData } from './compute';

// Outcome scoring for slalom and ball-control blocks (plan/12 §12.3): no form judgement.
// Slalom: start tone → stop-zone event, and lane-edge entries. V-pulls: ball direction reversals in
// the mastery square per 30 s window, with the ball leaving the square counted as a lost ball.
// All camera numbers are estimates until validated; without what they need they are unableToAssess.

/** A timed stretch of the block on the block's active clock (ms). */
export interface Window {
  label: string;
  startMs: number;
  endMs?: number;
}

export interface SlalomRun {
  label: string;
  startMs: number;
  stopZoneMs?: number;
  /** Start tone → stop zone (s, 0.1). */
  timeS?: number;
  laneEdgeEntries?: number;
  /** What saw the stop zone and the lane edges: the tracked ball (better) or motion in the zones. */
  source: 'ball' | 'motion';
  status: 'estimate' | 'unableToAssess';
  reason?: string;
}

export interface VPullWindow {
  label: string;
  startMs: number;
  endMs: number;
  reversals?: number;
  lostBall?: number;
  /** Share of the window in which the ball was actually seen. */
  coverage: number;
  status: 'estimate' | 'unableToAssess';
  reason?: string;
}

export const OUTCOME = {
  minRunMs: 800, // a stop-zone event sooner than this after the tone is the player still at the start
  runGraceMs: 3000, // the stop zone may be reached a little after the finish tap
  edgeDebounceMs: 500,
  minCoverage: 0.7,
  reversalDeg: 120,
  reversalDedupMs: 200,
  lostMs: 300,
};

const seenIn = (track: TrackSample[], from: number, to: number) => track.filter((s) => !s.predicted && s.tMs >= from && s.tMs <= to);

/** Entries of the ball into a polygon, debounced. */
function ballEntries(samples: TrackSample[], poly: Pt[]): number[] {
  const out: number[] = [];
  let inside = false;
  for (const s of samples) {
    const now = pointInPolygon({ x: s.x, y: s.y }, poly);
    if (now && !inside && (!out.length || s.tMs - out[out.length - 1] >= OUTCOME.edgeDebounceMs)) out.push(s.tMs);
    inside = now;
  }
  return out;
}

export function slalomRuns(
  frames: FrameData[],
  runs: Window[],
  opts: { stopZone: string; edges: string[]; polygons: Record<string, Pt[]>; track?: TrackSample[] },
): SlalomRun[] {
  return runs.map((r, i) => {
    const until = (runs[i + 1]?.startMs ?? Infinity) - 1;
    const to = Math.min(until, (r.endMs ?? until) + OUTCOME.runGraceMs);
    const from = r.startMs + OUTCOME.minRunMs;
    const stopPoly = opts.polygons[opts.stopZone];
    const seen = opts.track ? seenIn(opts.track, r.startMs, to) : [];
    const useBall = !!stopPoly && seen.length >= 10;
    let stopZoneMs: number | undefined;
    if (useBall) stopZoneMs = seen.find((s) => s.tMs >= from && pointInPolygon({ x: s.x, y: s.y }, stopPoly))?.tMs;
    else stopZoneMs = zoneEvents(frames.filter((f) => f.tMs >= from && f.tMs <= to), [opts.stopZone])[0]?.tMs;
    if (stopZoneMs === undefined) return { label: r.label, startMs: r.startMs, source: useBall ? 'ball' : 'motion', status: 'unableToAssess', reason: 'no stop-zone event seen' };
    const during = (t: number) => t >= r.startMs && t <= stopZoneMs!;
    let laneEdgeEntries: number;
    if (useBall) laneEdgeEntries = opts.edges.reduce((n, e) => n + (opts.polygons[e] ? ballEntries(seen.filter((s) => during(s.tMs)), opts.polygons[e]).length : 0), 0);
    else laneEdgeEntries = zoneEvents(frames.filter((f) => during(f.tMs)), opts.edges).length;
    return { label: r.label, startMs: r.startMs, stopZoneMs, timeS: Math.round((stopZoneMs - r.startMs) / 100) / 10, laneEdgeEntries, source: useBall ? 'ball' : 'motion', status: 'estimate' };
  });
}

/** Direction reversals (turns sharper than OUTCOME.reversalDeg) of the seen ball inside the square. */
function reversals(samples: TrackSample[], square: Pt[]): number {
  const s = samples.filter((p) => pointInPolygon({ x: p.x, y: p.y }, square));
  let n = 0;
  let last = -Infinity;
  for (let i = 1; i < s.length - 1; i++) {
    const v1 = { x: s[i].x - s[i - 1].x, y: s[i].y - s[i - 1].y };
    const v2 = { x: s[i + 1].x - s[i].x, y: s[i + 1].y - s[i].y };
    const m1 = Math.hypot(v1.x, v1.y);
    const m2 = Math.hypot(v2.x, v2.y);
    if (m1 < 1e-3 || m2 < 1e-3) continue;
    const turn = (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)))) * 180) / Math.PI;
    if (turn >= OUTCOME.reversalDeg && s[i].tMs - last >= OUTCOME.reversalDedupMs) {
      n++;
      last = s[i].tMs;
    }
  }
  return n;
}

export function vPullWindows(windows: Window[], square: Pt[] | undefined, track: TrackSample[] | undefined, fps: number): VPullWindow[] {
  return windows.map((w) => {
    const endMs = w.endMs ?? w.startMs + 30_000;
    const base = { label: w.label, startMs: w.startMs, endMs };
    if (!track) return { ...base, coverage: 0, status: 'unableToAssess' as const, reason: 'needs ball tracking' };
    if (!square) return { ...base, coverage: 0, status: 'unableToAssess' as const, reason: 'no square marked in the camera set-up' };
    const seen = seenIn(track, w.startMs, endMs);
    const coverage = Math.min(1, seen.length / Math.max(1, ((endMs - w.startMs) / 1000) * fps));
    if (coverage < OUTCOME.minCoverage) return { ...base, coverage, status: 'unableToAssess' as const, reason: `ball seen in ${Math.round(coverage * 100)}% of the window` };
    let lost = 0;
    let outSince: number | null = null;
    let counted = false;
    for (const s of seen) {
      if (pointInPolygon({ x: s.x, y: s.y }, square)) {
        outSince = null;
        counted = false;
      } else {
        outSince ??= s.tMs;
        if (!counted && s.tMs - outSince >= OUTCOME.lostMs) {
          lost++;
          counted = true;
        }
      }
    }
    return { ...base, reversals: reversals(seen, square), lostBall: lost, coverage, status: 'estimate' as const };
  });
}
