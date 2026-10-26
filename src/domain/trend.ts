import type { BenchmarkResult, BenchmarkValues } from '../db/types';
import { comparability } from './comparability';
import { resultLines } from './metrics';

// Benchmark trends for the charts (plan/05 §5.6 Benchmarks tab, part 15 D11). A trend only joins
// results at the same conditions as the latest reliable result; everything else is listed apart
// with its reason. Each measure keeps its own panel and scale: no combined score, no second axis,
// and a time is never charted without its error count beneath it.

export type Side = 'right' | 'left';

export interface TrendPoint {
  date: string;
  resultId: string;
  attempt: number;
  value: number;
}

export interface TrendSeries {
  key: string;
  label: string;
  side?: Side;
  points: TrendPoint[];
}

export interface TrendPanel {
  id: 'score' | 'gate' | 'vpulls' | 'time' | 'errors' | 'digits';
  title: string;
  /** Upper end of the scale when the measure has one (e.g. /30). */
  max?: number;
  unit: string;
  lowerIsBetter: boolean;
  series: TrendSeries[];
}

export interface Trend {
  reference: BenchmarkResult;
  included: BenchmarkResult[];
  /** Results at other conditions, with the reason they are not joined. */
  excluded: { result: BenchmarkResult; reason: string }[];
  /** Results marked unreliable: never charted. */
  unreliable: BenchmarkResult[];
  panels: TrendPanel[];
}

const sideOf = (key: string): Side | undefined => (key === 'right' || key === 'cb1r' ? 'right' : key === 'left' || key === 'cb1l' ? 'left' : undefined);

function scoreMax(v: BenchmarkValues): number | undefined {
  switch (v.kind) {
    case 'SB':
    case 'A2':
    case 'A4':
      return 10;
    case 'FB':
      return 30;
    case 'A3':
      return 16;
    case 'CA':
    case 'QUIZ':
      return v.outOf;
    default:
      return undefined;
  }
}

const byDate = (a: BenchmarkResult, b: BenchmarkResult) => a.date.localeCompare(b.date) || a.attempt - b.attempt;

/** The trend for one test (and drill, for cue accuracy), from counted results. */
export function trendFor(results: BenchmarkResult[], benchmarkId: string, drillId?: string): Trend | undefined {
  const mine = results.filter((r) => r.benchmarkId === benchmarkId && (drillId === undefined || r.drillId === drillId)).sort(byDate);
  const unreliable = mine.filter((r) => r.flagged);
  const reliable = mine.filter((r) => !r.flagged);
  const reference = reliable[reliable.length - 1];
  if (!reference) return undefined;
  const included: BenchmarkResult[] = [];
  const excluded: Trend['excluded'] = [];
  for (const r of reliable) {
    const c = comparability(reference, r);
    if (c.ok) included.push(r);
    else excluded.push({ result: r, reason: c.reason });
  }

  const panels = new Map<TrendPanel['id'], TrendPanel>();
  const panel = (id: TrendPanel['id'], make: () => Omit<TrendPanel, 'id' | 'series'>) => {
    let p = panels.get(id);
    if (!p) panels.set(id, (p = { id, ...make(), series: [] }));
    return p;
  };
  const add = (p: TrendPanel, key: string, label: string, r: BenchmarkResult, value: number) => {
    let s = p.series.find((x) => x.key === key);
    if (!s) p.series.push((s = { key, label, side: sideOf(key), points: [] }));
    s.points.push({ date: r.date, resultId: r.id, attempt: r.attempt, value });
  };

  for (const r of included) {
    for (const l of resultLines(r.values)) {
      if (l.timeS !== undefined) {
        add(panel('time', () => ({ title: 'Time', unit: 's', lowerIsBetter: true })), l.key, l.label, r, l.timeS);
        add(panel('errors', () => ({ title: 'Errors', unit: 'errors', lowerIsBetter: true })), l.key, l.label, r, l.errors ?? 0);
        if (l.extra !== undefined) add(panel('digits', () => ({ title: 'Digits read', unit: '/8', max: 8, lowerIsBetter: false })), l.key, l.label, r, l.extra);
      } else if (l.score !== undefined) {
        if (l.key === 'cb2') add(panel('gate', () => ({ title: 'Gate test', unit: '/10', max: 10, lowerIsBetter: false })), l.key, l.label, r, l.score);
        else if (l.key === 'cb1r' || l.key === 'cb1l') add(panel('vpulls', () => ({ title: 'V-pulls in 30 s', unit: 'in 30 s', lowerIsBetter: false })), l.key, l.label, r, l.score);
        else {
          const max = scoreMax(r.values);
          add(panel('score', () => ({ title: l.key === 'right' || l.key === 'left' ? 'Score' : l.label, unit: max ? `/${max}` : '', max, lowerIsBetter: false })), l.key, l.label, r, l.score);
        }
      }
    }
  }
  // Right before left wherever both appear, so each foot keeps its colour on every chart.
  for (const p of panels.values()) p.series.sort((a, b) => (a.side === 'left' ? 1 : 0) - (b.side === 'left' ? 1 : 0));
  return { reference, included, excluded, unreliable, panels: [...panels.values()] };
}

/** Consecutive points more than this many days apart are drawn with a gap, not a joining line. */
export const GAP_DAYS = 14;

export function segments(points: TrendPoint[], gapDays = GAP_DAYS): TrendPoint[][] {
  const out: TrendPoint[][] = [];
  for (const pt of points) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && (new Date(pt.date).getTime() - new Date(prev.date).getTime()) / 86_400_000 <= gapDays) last.push(pt);
    else out.push([pt]);
  }
  return out;
}
