import type { BenchmarkResult } from '../db/types';
import { localDate, localDay } from './dates';

// Benchmark trends only join results with the same context key (plan/05 §5.3, part 15 D11).

/** `legacy`: one result has no record of a context field the other has (made before that field was
 *  stored). Unknown never matches known (Brief R02); such results stay visible, listed apart. */
export type Comparability = { ok: true } | { ok: false; reason: string; legacy?: true };

export interface CompareOptions {
  /** Cue levels a stage rule explicitly treats as equivalent (content `cueLevels`); no others mix. */
  cueLevels?: string[];
}

const EXTENDED: [keyof BenchmarkResult['conditions'], string][] = [
  ['timing', 'timing method'],
  ['roomProfileVersion', 'room profile'],
  ['defenderArchetype', 'defender'],
  ['taskMode', 'task mode'],
  ['cameraConfidence', 'camera confidence'],
  ['ballProfileId', 'ball profile'],
  ['modelVersion', 'model version'],
];

const cueText = (c: string) => (/^\d+(\.\d+)?$/.test(c) ? `cue ${c} s` : c);

export function comparability(a: BenchmarkResult, b: BenchmarkResult, opts: CompareOptions = {}): Comparability {
  if (a.benchmarkId !== b.benchmarkId) return { ok: false, reason: 'different tests' };
  // A result a parent marked unreliable (start tone missed, timed by hand...) joins no comparison.
  if (b.flagged) return { ok: false, reason: `marked unreliable (${b.flagged})` };
  if (a.flagged) return { ok: false, reason: `this result is marked unreliable (${a.flagged})` };
  if (a.drillId !== b.drillId && (a.drillId || b.drillId)) return { ok: false, reason: `different drills (${a.drillId ?? '—'} vs ${b.drillId ?? '—'})` };
  if (a.conditions.layoutVersion !== b.conditions.layoutVersion) {
    return { ok: false, reason: `different room layout (v${b.conditions.layoutVersion} then, v${a.conditions.layoutVersion} now)` };
  }
  const equivalentCues = !!opts.cueLevels && opts.cueLevels.includes(a.conditions.cueLevel) && opts.cueLevels.includes(b.conditions.cueLevel);
  if (a.conditions.cueLevel !== b.conditions.cueLevel && !equivalentCues) {
    return { ok: false, reason: `different cue level (${cueText(b.conditions.cueLevel)} then, ${cueText(a.conditions.cueLevel)} now)` };
  }
  // Extended context key (part 15 D11). A field neither result has is not part of this test's context
  // (so irrelevant fields don't fragment history); a field only one has is unknown on the other, and
  // unknown never matches known (Brief R02).
  for (const [k, label] of EXTENDED) {
    const x = a.conditions[k];
    const y = b.conditions[k];
    if (x === undefined && y === undefined) continue;
    if (x === undefined || y === undefined) {
      return { ok: false, legacy: true, reason: `${label} not recorded on ${y === undefined ? 'the earlier' : 'this'} result` };
    }
    if (x !== y) return { ok: false, reason: `different ${label} (${y} then, ${x} now)` };
  }
  return { ok: true };
}

export const sameConditions = (a: BenchmarkResult, b: BenchmarkResult) => comparability(a, b).ok;

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
  // Local calendar days throughout (a picked date is already one).
  const target =
    pick.kind === 'date'
      ? pick.date
      : (() => {
          const d = new Date(now.date);
          d.setMonth(d.getMonth() - pick.months);
          return localDate(d);
        })();
  // The latest result on or before the target date; if none, the earliest one after it.
  const onOrBefore = earlier.find((r) => localDay(r.date) <= target);
  return onOrBefore ?? earlier[earlier.length - 1];
}
