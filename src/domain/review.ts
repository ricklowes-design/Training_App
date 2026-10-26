import type { Programme } from '../content/types';
import type { Advancement, BenchmarkResult, CoachNote, Override, SessionRecord } from '../db/types';
import { areaName } from './plans';
import { countedResults, countsForWeek, isRecorded } from './records';
import { trendFor, type TrendPanel, type TrendPoint } from './trend';

// The monthly Review tab (plan/05 §5.6). Counts follow the same rules as the Week tab: completed
// programme sessions only. Benchmark changes join only results at the same conditions (trendFor),
// a time always carries its errors, and there is no combined score.

export interface MonthReviewInput {
  programme: Programme;
  records: SessionRecord[];
  results: BenchmarkResult[];
  notes: CoachNote[];
  overrides: Override[];
  advancements: Advancement[];
  weeklyTarget: number;
}

export interface MonthReview {
  title: string;
  start: Date;
  end: Date;
  completed: number;
  planned: number;
  partial: number;
  stopped: number;
  areas: { id: string; name: string; sessions: number }[];
  benchmarks: string[];
  leftRight: string[];
  advanced: string[];
  coach: string[];
  /** Benchmarks with results in the month that are charted. */
  charted: { benchmarkId: string; drillId?: string }[];
}

const DAY_MS = 86_400_000;
const inRange = (iso: string, a: Date, b: Date) => new Date(iso) >= a && new Date(iso) < b;
const short = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const n1 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(year, month, 1), end: new Date(year, month + 1, 1) };
}

/** "SB 7→9/10", "DB R 9.8→9.4 s (errors 1→1)": first and last result in the month at the same conditions. */
function benchmarkLine(id: string, panels: TrendPanel[], a: Date, b: Date): string | null {
  const parts: string[] = [];
  const time = panels.find((p) => p.id === 'time');
  const errors = panels.find((p) => p.id === 'errors');
  for (const p of panels) {
    if (p.id === 'errors' || p.id === 'digits') continue;
    for (const s of p.series) {
      const pts = s.points.filter((x) => inRange(x.date, a, b));
      if (!pts.length) continue;
      const first = pts[0];
      const last = pts[pts.length - 1];
      const tag = s.side ? (s.side === 'right' ? 'R' : 'L') : p.id === 'gate' ? 'gate' : '';
      const label = p.id === 'vpulls' ? `V-pulls ${tag}` : tag;
      const span = pts.length > 1 ? `${n1(first.value)}→${n1(last.value)}` : n1(last.value);
      if (p === time) {
        const es = errors?.series.find((x) => x.key === s.key)?.points.filter((x) => inRange(x.date, a, b)) ?? [];
        const e = (pt: TrendPoint) => es.find((x) => x.resultId === pt.resultId)?.value ?? 0;
        const espan = pts.length > 1 ? `${e(first)}→${e(last)}` : String(e(last));
        parts.push(`${label} ${span} s (errors ${espan})`.trim());
      } else {
        parts.push(`${label} ${span}${p.max ? `/${p.max}` : p.id === 'vpulls' ? ' in 30 s' : ''}`.trim());
      }
    }
  }
  return parts.length ? `${id} ${parts.join(', ')}` : null;
}

/** Left as a share of right, for scored two-footed measures: latest in the month, and before it. */
function leftRightLine(id: string, panels: TrendPanel[], a: Date, b: Date): string | null {
  for (const p of panels) {
    if (p.lowerIsBetter) continue;
    const r = p.series.find((s) => s.side === 'right');
    const l = p.series.find((s) => s.side === 'left');
    if (!r || !l) continue;
    const ratio = (until: Date, from?: Date): number | undefined => {
      const rp = r.points.filter((x) => new Date(x.date) < until && (!from || new Date(x.date) >= from)).pop();
      const lp = rp && l.points.find((x) => x.resultId === rp.resultId);
      return rp && lp && rp.value > 0 ? Math.round((100 * lp.value) / rp.value) : undefined;
    };
    const now = ratio(b, a);
    if (now === undefined) continue;
    const before = ratio(a);
    const what = p.id === 'vpulls' ? `${id} V-pulls` : id;
    return `${what} left ${now}% of right${before !== undefined ? ` (was ${before}%)` : ''}`;
  }
  return null;
}

export function monthReview(d: MonthReviewInput, year: number, month: number, now = new Date()): MonthReview {
  const { programme: p } = d;
  const { start, end } = monthBounds(year, month);
  const until = end < now ? end : now;
  const recs = d.records.filter((r) => inRange(r.date, start, end));
  const done = recs.filter(countsForWeek);
  const programmeRecs = recs.filter((r) => r.kind === 'programme' && isRecorded(r));
  // Planned: the weekly target spread over the days of the month so far.
  const days = Math.max(0, Math.ceil((until.getTime() - start.getTime()) / DAY_MS));
  const planned = Math.round((d.weeklyTarget * days) / 7);

  const areas = p.areas.map((a) => ({ id: a.id, name: areaName(p, a.id), sessions: done.filter((r) => r.areaId === a.id).length })).filter((a) => a.sessions > 0);

  // Every test with a counted result this month, charted against results up to the month's end.
  const counted = countedResults(d.results, d.records).filter((r) => new Date(r.date) < end);
  const tests = new Map<string, { benchmarkId: string; drillId?: string }>();
  for (const r of counted.filter((x) => inRange(x.date, start, end) && x.benchmarkId !== 'QUIZ')) {
    const drillId = r.benchmarkId === 'CA' ? r.drillId : undefined;
    tests.set(`${r.benchmarkId}:${drillId ?? ''}`, { benchmarkId: r.benchmarkId, drillId });
  }
  const order = [...p.benchmarks.map((b) => b.id), ...p.anchors.map((a) => a.id)];
  const charted = [...tests.values()].sort((x, y) => order.indexOf(x.benchmarkId) - order.indexOf(y.benchmarkId) || (x.drillId ?? '').localeCompare(y.drillId ?? ''));
  const benchmarks: string[] = [];
  const leftRight: string[] = [];
  for (const t of charted) {
    const tr = trendFor(counted, t.benchmarkId, t.drillId);
    if (!tr) continue;
    const id = t.drillId ? `${t.benchmarkId} ${t.drillId}` : t.benchmarkId;
    const line = benchmarkLine(id, tr.panels, start, end);
    if (line) benchmarks.push(line);
    const lr = leftRightLine(id, tr.panels, start, end);
    if (lr) leftRight.push(lr);
  }

  const stageOrder = (id: string) => p.stages.find((s) => s.id === id)?.order ?? id;
  const advanced = d.advancements
    .filter((a) => a.decision === 'confirmed' && inRange(a.date, start, end))
    .sort((x, y) => x.date.localeCompare(y.date))
    .map((a) => `${areaName(p, a.areaId)} Stage ${stageOrder(a.from)}→${a.to === 'exit' ? 'area complete' : stageOrder(a.to)} (confirmed ${short(a.date)})`);

  const notes = d.notes.filter((n) => inRange(n.date, start, end)).sort((x, y) => x.date.localeCompare(y.date));
  const changes = d.overrides.filter((o) => inRange(o.date, start, end) && !o.revertedAt);
  const coach: string[] = [];
  if (notes.length) coach.push(`${notes.length} note${notes.length > 1 ? 's' : ''} (${notes.map((n) => short(n.date)).join(', ')})`);
  if (changes.length) coach.push(`changes: ${[...new Set(changes.map((o) => `${o.target.id} ${o.field}`))].join(', ')}`);

  return {
    title: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    start,
    end,
    completed: done.length,
    planned,
    partial: programmeRecs.filter((r) => r.status === 'partial').length,
    stopped: programmeRecs.filter((r) => r.status === 'stopped').length,
    areas,
    benchmarks,
    leftRight,
    advanced,
    coach,
    charted,
  };
}

/** The plain-text summary the parent can export (the only way the review leaves the Chromebook). */
export function reviewText(m: MonthReview, keptClips: number): string {
  const extra = [m.partial ? `${m.partial} partial` : '', m.stopped ? `${m.stopped} stopped` : ''].filter(Boolean).join(', ');
  return [
    m.title,
    `Consistency: ${m.completed} of ${m.planned} planned sessions completed${extra ? ` (${extra})` : ''}`,
    `Areas: ${m.areas.length ? m.areas.map((a) => `${a.name} ${a.sessions}`).join(' · ') : '—'}`,
    `Benchmarks: ${m.benchmarks.length ? m.benchmarks.join(' · ') : '—'}`,
    `Left/right: ${m.leftRight.length ? m.leftRight.join(' · ') : '—'}`,
    `Advanced: ${m.advanced.length ? m.advanced.join(' · ') : '—'}`,
    `Coach feedback: ${m.coach.length ? m.coach.join(' → ') : '—'}`,
    `Clips marked for review: ${keptClips}`,
  ].join('\n');
}
