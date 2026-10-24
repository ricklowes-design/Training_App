import type { Pt } from '../db/types';
import { gateEvents, touches, type GateEvent, type TouchEvent } from './events';
import type { TrackSample } from './track';

export interface BallSummary {
  samples: number;
  seenShare: number; // share of frames with a detected (not predicted) ball
  predictedShare: number;
  gateEvents: GateEvent[];
  touches: { confirmed: number; possible: number; events: TouchEvent[] };
  /** Always an estimate until the part 17 validation sets thresholds. */
  status: 'estimate' | 'unableToAssess';
  profileId: string;
  /** What found the ball: the registered colour model, the experimental detector model, or both. */
  detector?: 'colour' | 'model' | 'colour+model';
}

/** A gate line from a gate zone drawn in camera set-up: across the zone at its middle height. */
export function gateLine(poly: Pt[]): { a: Pt; b: Pt } {
  const ys = poly.map((p) => p.y);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const xs = poly.map((p) => p.x);
  return { a: { x: Math.min(...xs), y }, b: { x: Math.max(...xs), y } };
}

export function summarise(track: TrackSample[], frames: number, gates: { name: string; polygon: Pt[] }[], profileId: string, detector: BallSummary['detector'] = 'colour'): BallSummary {
  const seen = track.filter((s) => !s.predicted).length;
  const ev = gates.flatMap((g) => gateEvents(track, { name: g.name, ...gateLine(g.polygon) })).sort((a, b) => a.tMs - b.tMs);
  const t = touches(track);
  const seenShare = frames ? seen / frames : 0;
  return {
    samples: track.length,
    seenShare: Math.round(100 * seenShare) / 100,
    predictedShare: frames ? Math.round((100 * (track.length - seen)) / frames) / 100 : 0,
    gateEvents: ev,
    touches: { confirmed: t.filter((x) => x.status === 'confirmed').length, possible: t.filter((x) => x.status === 'possible').length, events: t },
    status: seenShare >= 0.5 ? 'estimate' : 'unableToAssess',
    profileId,
    detector,
  };
}
