import type { BuilderSlot, BuilderTemplate, ContentBlock, ContentSession, Programme } from '../content/types';
import type { RecordKind, RunBlockKind } from '../db/types';

/** One block as the session runner will run it. */
export interface RunBlock {
  kind: RunBlockKind;
  minutes: number;
  mode: 'timed' | 'reps';
  areaId?: string;
  partIndex?: number; // which part (area) of a multi-area run this belongs to
  drillId?: string; // 'choice' = the player picks at the demo view
  params?: string;
  benchmarkId?: string;
  cueLevel?: string;
  alsoCueAccuracy?: boolean;
  coachTransferRequested?: boolean;
  anchorId?: string;
  fromSlot?: 'A' | 'B' | 'C';
}

/** One area's share of a run; each part becomes its own SessionRecord. */
export interface RunPart {
  kind: RecordKind;
  areaId?: string;
  sessionId?: string;
  sessionNumber?: number;
}

export interface RunPlan {
  title: string;
  parts: RunPart[];
  blocks: RunBlock[];
  totalMinutes: number;
  light: boolean;
  partner: boolean;
}

export const planMinutes = (blocks: { minutes: number }[]) => blocks.reduce((t, b) => t + b.minutes, 0);

function drillMode(p: Programme, drillId: string | undefined): 'timed' | 'reps' {
  if (!drillId || drillId === 'choice') return 'reps';
  return p.drills.find((d) => d.id === drillId)?.mode ?? 'timed';
}

function fromContentBlock(p: Programme, b: ContentBlock, areaId: string | undefined, partIndex: number): RunBlock {
  if (b.type === 'work') {
    return { kind: 'work', minutes: b.minutes, mode: drillMode(p, b.drillId), areaId, partIndex, drillId: b.drillId, params: b.params };
  }
  if (b.type === 'benchmark') {
    return {
      kind: 'benchmark',
      minutes: b.minutes,
      mode: 'reps',
      areaId,
      partIndex,
      benchmarkId: b.benchmarkId,
      cueLevel: b.cueLevel,
      alsoCueAccuracy: b.alsoCueAccuracy,
      coachTransferRequested: b.coachTransferRequested,
    };
  }
  return { kind: b.type, minutes: b.minutes, mode: 'timed', areaId: b.type === 'warmup' || b.type === 'log' ? undefined : areaId, partIndex };
}

export function areaName(p: Programme, areaId: string): string {
  const a = p.areas.find((x) => x.id === areaId);
  return a ? a.name.split(' and ')[0] : areaId;
}

export function findSession(p: Programme, areaId: string, n: number): ContentSession | undefined {
  return p.sessions.find((s) => s.areaId === areaId && s.number === n);
}

/** The standard 20-minute session, exactly as the content defines it. */
export function standardPlan(p: Programme, session: ContentSession, opts: { partner?: boolean; kind?: RecordKind } = {}): RunPlan {
  const blocks = session.blocks.map((b) => fromContentBlock(p, b, session.areaId, 0));
  return {
    title: `${areaName(p, session.areaId)} · Session ${session.number}`,
    parts: [{ kind: opts.kind ?? 'programme', areaId: session.areaId, sessionId: session.id, sessionNumber: session.number }],
    blocks,
    totalMinutes: planMinutes(blocks),
    light: false,
    partner: !!opts.partner,
  };
}

export function baselinePlan(p: Programme, areaId: string): RunPlan {
  const bl = p.baselines.find((b) => b.areaId === areaId);
  if (!bl) throw new Error(`No baseline for ${areaId}`);
  const blocks = bl.blocks.map((b) => fromContentBlock(p, b, areaId, 0));
  return {
    title: `${areaName(p, areaId)} · Baseline`,
    parts: [{ kind: 'baseline', areaId }],
    blocks,
    totalMinutes: planMinutes(blocks),
    light: false,
    partner: false,
  };
}

function workBlocks(s: ContentSession) {
  return s.blocks.filter((b): b is Extract<ContentBlock, { type: 'work' }> => b.type === 'work');
}

function benchmarkBlock(s: ContentSession) {
  return s.blocks.find((b): b is Extract<ContentBlock, { type: 'benchmark' }> => b.type === 'benchmark');
}

function fillSlot(p: Programme, slot: BuilderSlot, sessions: ContentSession[], light: boolean): RunBlock {
  if (slot.type === 'work') {
    const s = sessions[slot.area];
    const works = workBlocks(s);
    const pick = slot.from === 'A' ? works[0] : slot.from === 'B' ? works[1] : works[2] ?? works[0];
    const params = slot.from === 'C' && !works[2] ? 'short repeat' : pick.params;
    return { kind: 'work', minutes: slot.minutes, mode: drillMode(p, pick.drillId), areaId: s.areaId, partIndex: slot.area, drillId: pick.drillId, params, fromSlot: slot.from };
  }
  if (slot.type === 'benchmark') {
    const s = sessions[slot.area];
    if (light) return { kind: 'rest', minutes: slot.minutes, mode: 'timed', partIndex: slot.area };
    const bm = benchmarkBlock(s);
    if (bm) {
      return {
        kind: 'benchmark',
        minutes: slot.minutes,
        mode: 'reps',
        areaId: s.areaId,
        partIndex: slot.area,
        benchmarkId: bm.benchmarkId,
        cueLevel: bm.cueLevel,
        alsoCueAccuracy: bm.alsoCueAccuracy,
        coachTransferRequested: bm.coachTransferRequested,
      };
    }
    // No benchmark in this session: the slot repeats block A.
    const a = workBlocks(s)[0];
    return { kind: 'work', minutes: slot.minutes, mode: drillMode(p, a.drillId), areaId: s.areaId, partIndex: slot.area, drillId: a.drillId, params: 'short repeat', fromSlot: 'A' };
  }
  if (slot.type === 'quiz') return { kind: 'quiz', minutes: slot.minutes, mode: 'timed', drillId: slot.drillId };
  return { kind: slot.type, minutes: slot.minutes, mode: 'timed' };
}

export function templatesFor(p: Programme, minutes: number, areas: number, light: boolean): BuilderTemplate | undefined {
  return p.builder.templates.find((t) => t.minutes === minutes && t.areas === areas && !!t.light === light);
}

/** Area counts the builder can offer for a duration (from the content's templates). */
export function areaCountsFor(p: Programme, minutes: number): number[] {
  const counts = new Set<number>();
  if (minutes === 20) counts.add(1);
  for (const t of p.builder.templates) if (t.minutes === minutes && !t.light) counts.add(t.areas);
  return [...counts].sort();
}

export interface BuildRequest {
  minutes: number;
  sessions: ContentSession[]; // the next unlocked session in each chosen area, in order
  light: boolean;
  partner: boolean;
}

export type BuildResult = { ok: true; plan: RunPlan } | { ok: false; reason: string };

/** Session builder (plan/02 §2.4, plan/04). Always uses the sessions it is given, which are the next unlocked ones. */
export function buildPlan(p: Programme, req: BuildRequest): BuildResult {
  const { minutes, sessions, light, partner } = req;
  if (sessions.length === 0) return { ok: false, reason: 'Pick at least one area.' };
  const areaIds = sessions.map((s) => s.areaId);
  if (new Set(areaIds).size !== areaIds.length) return { ok: false, reason: 'Each area can only appear once.' };

  if (minutes === 20 && sessions.length === 1 && !light) {
    return { ok: true, plan: { ...standardPlan(p, sessions[0], { partner }) } };
  }
  // Light: the 20-minute light template, or the longer template with benchmark slots turned to rest.
  const template = (light && templatesFor(p, minutes, sessions.length, true)) || templatesFor(p, minutes, sessions.length, false);
  if (!template) return { ok: false, reason: `No ${minutes}-minute template for ${sessions.length} area${sessions.length > 1 ? 's' : ''}.` };

  const blocks = template.slots.map((slot) => fillSlot(p, slot, sessions, light));
  const total = planMinutes(blocks);
  if (total !== minutes) return { ok: false, reason: `Blocks add up to ${total} minutes, not ${minutes}.` };
  const names = sessions.map((s) => `${areaName(p, s.areaId)} S${s.number}`).join(' + ');
  return {
    ok: true,
    plan: {
      title: `${minutes} min${light ? ' · light' : ''} · ${names}`,
      parts: sessions.map((s) => ({ kind: 'programme' as const, areaId: s.areaId, sessionId: s.id, sessionNumber: s.number })),
      blocks,
      totalMinutes: total,
      light,
      partner,
    },
  };
}

/** No-ball recognition: picture quiz plus mobility. An extra; never unlocks. */
export function noBallPlan(p: Programme): RunPlan {
  const blocks = p.builder.noBall.slots.map((slot) => fillSlot(p, slot, [], false));
  return { title: 'No-ball picture quiz', parts: [{ kind: 'extra' }], blocks, totalMinutes: planMinutes(blocks), light: true, partner: false };
}

/** The optional scanning diagnostic (part 15 D8): S3 with numbers, tells visual acquisition from interpretation. An extra; never routine. */
export function digitDiagnosticPlan(p: Programme): RunPlan | null {
  const d = p.drills.find((x) => x.routine === false && x.areaId === 'scanning');
  if (!d) return null;
  const blocks: RunBlock[] = [
    { kind: 'warmup', minutes: 3, mode: 'timed' },
    { kind: 'work', minutes: 6, mode: 'reps', drillId: d.id, areaId: d.areaId, params: 'diagnostic, cue 2 s' },
  ];
  return { title: `${d.name}`, parts: [{ kind: 'extra' }], blocks, totalMinutes: planMinutes(blocks), light: true, partner: false };
}

/** Repeat of an already-completed session: recorded as an extra. */
export function repeatPlan(p: Programme, session: ContentSession): RunPlan {
  const plan = standardPlan(p, session, { kind: 'extra' });
  return { ...plan, title: `${plan.title} (repeat)` };
}

/** The fortnightly anchor check (plan/13 §13.4). */
export function anchorPlan(p: Programme): RunPlan {
  const blocks: RunBlock[] = p.anchorCheck.blocks.map((b) => {
    if (b.type === 'warmup') return { kind: 'warmup', minutes: b.minutes, mode: 'timed' };
    const an = p.anchors.find((a) => a.id === b.id);
    return { kind: 'anchor', minutes: b.minutes, mode: 'reps', anchorId: b.id, drillId: an?.drillId };
  });
  return { title: 'Anchor check', parts: [{ kind: 'anchor' }], blocks, totalMinutes: planMinutes(blocks), light: false, partner: false };
}

export function warmupMinutesFor(p: Programme, total: number): number {
  const w = p.warmup;
  return total >= 60 ? w.minutes60 : total >= 45 ? w.minutes45 : total >= 30 ? w.minutes30 : w.minutes20;
}
