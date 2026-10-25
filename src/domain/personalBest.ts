import type { BenchmarkResult } from '../db/types';
import { comparability } from './comparability';
import { resultLines, type ResultLine } from './metrics';

// Personal best (plan/05 §5.1): the best comparable result, per line (pattern, foot or part),
// among results at the same conditions as `now` (layout version, cue level, room, task mode...).
// Results marked unreliable never count. No composite score: a scored line keeps its highest
// score; a timed line keeps the run with the fewest errors and, among those, the fastest, and its
// time is always shown with its error count.

export interface PersonalBest {
  key: string;
  label: string;
  text: string;
  date: string;
  resultId: string;
  /** True when the best is the result being looked at. */
  isNow: boolean;
}

function better(a: ResultLine, b: ResultLine): boolean {
  if (a.timeS !== undefined && b.timeS !== undefined) {
    const ea = a.errors ?? 0;
    const eb = b.errors ?? 0;
    return ea < eb || (ea === eb && a.timeS < b.timeS);
  }
  return (a.score ?? -Infinity) > (b.score ?? -Infinity);
}

export function personalBests(now: BenchmarkResult, all: BenchmarkResult[]): PersonalBest[] {
  const pool = [now, ...all.filter((r) => r.id !== now.id && comparability(now, r).ok)].filter((r) => !r.flagged);
  if (!pool.length) return [];
  const best = new Map<string, { line: ResultLine; r: BenchmarkResult }>();
  for (const r of pool)
    for (const line of resultLines(r.values)) {
      if (line.score === undefined && line.timeS === undefined) continue;
      const cur = best.get(line.key);
      // Ties keep the earlier result: the best was first reached then.
      if (!cur || better(line, cur.line) || (!better(cur.line, line) && r.date < cur.r.date)) best.set(line.key, { line, r });
    }
  return [...best.values()].map(({ line, r }) => ({ key: line.key, label: line.label, text: line.text, date: r.date, resultId: r.id, isNow: r.id === now.id }));
}
