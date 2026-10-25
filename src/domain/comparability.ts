import type { BenchmarkResult } from '../db/types';

// Benchmark trends only join results with the same context key (plan/05 §5.3, part 15 D11).

export type Comparability = { ok: true } | { ok: false; reason: string };

const EXTENDED: [keyof BenchmarkResult['conditions'], string][] = [
  ['roomProfileVersion', 'room profile'],
  ['defenderArchetype', 'defender'],
  ['taskMode', 'task mode'],
  ['cameraConfidence', 'camera confidence'],
  ['ballProfileId', 'ball profile'],
  ['modelVersion', 'model version'],
];

const cueText = (c: string) => (/^\d+(\.\d+)?$/.test(c) ? `cue ${c} s` : c);

export function comparability(a: BenchmarkResult, b: BenchmarkResult): Comparability {
  if (a.benchmarkId !== b.benchmarkId) return { ok: false, reason: 'different tests' };
  // A result a parent marked unreliable (start tone missed, timed by hand...) joins no comparison.
  if (b.flagged) return { ok: false, reason: `marked unreliable (${b.flagged})` };
  if (a.flagged) return { ok: false, reason: `this result is marked unreliable (${a.flagged})` };
  if (a.drillId !== b.drillId && (a.drillId || b.drillId)) return { ok: false, reason: `different drills (${a.drillId ?? '—'} vs ${b.drillId ?? '—'})` };
  if (a.conditions.layoutVersion !== b.conditions.layoutVersion) {
    return { ok: false, reason: `different room layout (v${b.conditions.layoutVersion} then, v${a.conditions.layoutVersion} now)` };
  }
  if (a.conditions.cueLevel !== b.conditions.cueLevel) {
    return { ok: false, reason: `different cue level (${cueText(b.conditions.cueLevel)} then, ${cueText(a.conditions.cueLevel)} now)` };
  }
  // Extended context key (part 15 D11): compared when both results carry the field, so results from
  // before the plan update keep their trend unless something actually changed.
  for (const [k, label] of EXTENDED) {
    const x = a.conditions[k];
    const y = b.conditions[k];
    if (x !== undefined && y !== undefined && x !== y) return { ok: false, reason: `different ${label} (${y} then, ${x} now)` };
  }
  return { ok: true };
}

export const sameConditions = (a: BenchmarkResult, b: BenchmarkResult) => comparability(a, b).ok;

/** Results for one test, newest first. */
export function historyFor(results: BenchmarkResult[], benchmarkId: string, drillId?: string): BenchmarkResult[] {
  return results
    .filter((r) => r.benchmarkId === benchmarkId && (drillId === undefined || r.drillId === drillId))
    .sort((x, y) => y.date.localeCompare(x.date) || y.attempt - x.attempt);
}

/** The latest earlier result at the same conditions (the "last time" on the end-of-drill card). */
export function lastComparable(now: BenchmarkResult, results: BenchmarkResult[]): BenchmarkResult | undefined {
  return results
    .filter((r) => r.id !== now.id && sameConditions(now, r) && (r.date < now.date || (r.date === now.date && r.attempt < now.attempt)))
    .sort((x, y) => y.date.localeCompare(x.date) || y.attempt - x.attempt)[0];
}

export type ComparePick = { kind: 'last' } | { kind: 'monthsAgo'; months: number } | { kind: 'date'; date: string };

/** The comparison picker (plan/13 §13.3). Picks among results at the same conditions only. */
export function pickComparison(now: BenchmarkResult, results: BenchmarkResult[], pick: ComparePick): BenchmarkResult | undefined {
  const earlier = results
    .filter((r) => r.id !== now.id && sameConditions(now, r) && r.date <= now.date)
    .sort((x, y) => y.date.localeCompare(x.date) || y.attempt - x.attempt);
  if (pick.kind === 'last') return earlier.find((r) => r.date < now.date || r.attempt < now.attempt);
  const target =
    pick.kind === 'date'
      ? pick.date
      : (() => {
          const d = new Date(now.date);
          d.setMonth(d.getMonth() - pick.months);
          return d.toISOString();
        })();
  // The latest result on or before the target date; if none, the earliest one after it.
  const onOrBefore = earlier.find((r) => r.date.slice(0, 10) <= target.slice(0, 10));
  return onOrBefore ?? earlier[earlier.length - 1];
}
