import type { AdvancementRule, Programme } from '../content/types';
import type { Advancement, BenchmarkResult, ExtraCriterion, TransferObs } from '../db/types';
import { comparability, sameConditions } from './comparability';
import { metricValue, resultLines } from './metrics';

// Stage advancement (plan/03 criteria, plan/06 §6.4 item 5). The app checks what the
// numbers can show; anything else is a parent check at confirmation time.

export interface RuleStatus {
  rule: AdvancementRule;
  criteriaText: string;
  qualifying: number; // different days with a passing result in the trailing run, capped at `consecutive`
  needed: number;
  /** Passing results the player scored alone: shown, but not evidence for advancement (part 15 D12). */
  selfScoredIgnored: number;
  /** Qualifying results counted on the player's score that a parent should check before confirming. */
  toCheck: BenchmarkResult[];
  /** Passing results left out, with why and what to do next (Brief R02). */
  notCounted: { result: BenchmarkResult; reason: string; next: string }[];
  extraOpen: ExtraCriterion[];
  met: boolean;
  latest?: BenchmarkResult;
  withheld?: Advancement;
}

export function ruleFor(p: Programme, areaId: string, fromStage: string): AdvancementRule | undefined {
  return p.advancementRules.find((r) => r.areaId === areaId && r.from === fromStage);
}

export function passes(rule: AdvancementRule, r: BenchmarkResult): boolean {
  return rule.checks.every((c) => {
    const v = metricValue(r.values, c.metric);
    if (v === undefined) return false;
    return c.op === '>=' ? v >= c.value : v <= c.value;
  });
}

function forRule(rule: AdvancementRule, counted: BenchmarkResult[]): BenchmarkResult[] {
  if (!rule.benchmarkId) return [];
  return counted
    .filter((r) => r.benchmarkId === rule.benchmarkId && r.areaId === rule.areaId)
    .filter((r) => !rule.cueLevels || rule.cueLevels.includes(r.conditions.cueLevel))
    .filter((r) => !rule.drillIds || (r.drillId !== undefined && rule.drillIds.includes(r.drillId)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.attempt - b.attempt);
}

/** Results that can count toward the rule, oldest first: those comparable with the latest under the full
 *  context key (Brief R02: not just the layout). A rule may accept several settings (cue levels, pace),
 *  but the passing days must all be at the same one (owner decision 2026-10-30). */
export function candidates(rule: AdvancementRule, counted: BenchmarkResult[]): BenchmarkResult[] {
  const list = forRule(rule, counted);
  const last = list[list.length - 1];
  return last ? list.filter((r) => r === last || comparability(last, r).ok) : [];
}

/** Benchmarks the app scores by itself with a validated method (the quiz's own answer key). Any other
 *  app-only score counts only when the camera measure behind it passed its validation (`validatedBy`). */
const APP_VALIDATED = new Set(['QUIZ']);

/** `needsCheck`: counted on the player's score, but a parent should check it before confirming a stage. */
export type Evidence = { ok: true; needsCheck?: boolean } | { ok: false; reason: string; next: string };

/** One contract for whether a result can stand as evidence of progress (Brief R02, owner decisions
 *  2026-10-30). Parent or coach scoring counts. A player's score counts when other evidence backs it
 *  (`support`), and counts but needs a parent's check when it doesn't. The camera's own score counts
 *  only when its measure passed validation. */
export function evidenceFor(r: BenchmarkResult): Evidence {
  if (r.flagged) return { ok: false, reason: `marked unreliable (${r.flagged})`, next: 'Run the test again when it can be scored properly.' };
  if (r.conditions.recordedBy === 'self') {
    if (r.review?.outcome === 'ok') return { ok: true };
    if (!r.support) return { ok: false, reason: 'scored by the player alone, before score checks existed', next: 'Run the test again.' };
    return r.support.level === 'strong' ? { ok: true } : { ok: true, needsCheck: true };
  }
  if (r.conditions.recordedBy === 'app' && !APP_VALIDATED.has(r.benchmarkId) && !r.conditions.validatedBy) {
    return { ok: false, reason: 'automatic score not yet validated', next: 'Run the test again with a parent scoring.' };
  }
  return { ok: true };
}

/** Results that can count as evidence for stage advancement. */
export const evidenceOk = (r: BenchmarkResult): boolean => evidenceFor(r).ok;

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function evaluateRule(
  p: Programme,
  rule: AdvancementRule,
  counted: BenchmarkResult[],
  _transfers: TransferObs[], // kept for callers; transfer notes no longer gate advancement
  extra: ExtraCriterion[] = [],
  decisions: Advancement[] = [],
): RuleStatus {
  // The latest result with valid evidence sets the context; only results comparable with it count.
  const ruled = forRule(rule, counted);
  const valid = ruled.filter(evidenceOk);
  const ref = valid[valid.length - 1];
  const list = ref ? valid.filter((r) => r === ref || comparability(ref, r).ok) : [];
  const all = candidates(rule, counted);
  const run: BenchmarkResult[] = [];
  for (let i = list.length - 1; i >= 0 && passes(rule, list[i]); i--) run.push(list[i]);
  // Repeated success on different days (part 15 D12): two passes on one day count once.
  const trailing = new Set(run.map((r) => localDay(r.date))).size;
  const selfScoredIgnored = all.filter((r) => r.conditions.recordedBy === 'self' && !r.flagged && !evidenceOk(r) && passes(rule, r)).length;
  const counting = new Set(run.map((r) => localDay(r.date)));
  const toCheck = run.filter((r) => { const e = evidenceFor(r); return e.ok && e.needsCheck; }).filter((r) => counting.has(localDay(r.date)));
  const notCounted: RuleStatus['notCounted'] = [];
  for (const r of ruled) {
    if (list.includes(r) || !passes(rule, r)) continue;
    const e = evidenceFor(r);
    if (!e.ok) notCounted.push({ result: r, reason: e.reason, next: e.next });
    else if (ref) {
      const c = comparability(ref, r);
      if (!c.ok) notCounted.push({ result: r, reason: c.reason, next: 'Results under the current set-up count; run the test again as set up now.' });
    }
  }
  const needed = rule.consecutive;
  const extraOpen = extra.filter((x) => x.areaId === rule.areaId && x.from === rule.from && !x.metAt);
  // Coach transfer notes are no longer required (owner decision 2026-10-30): the end of an area is
  // confirmed by a parent after a feedback session with the coach.
  const met = trailing >= needed && extraOpen.length === 0;
  const withheld = [...decisions]
    .filter((d) => d.areaId === rule.areaId && d.from === rule.from && d.to === rule.to)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return {
    rule,
    criteriaText: p.advancement[rule.areaId]?.[`${rule.from}->${rule.to}`] ?? '',
    qualifying: Math.min(trailing, needed),
    needed,
    selfScoredIgnored,
    notCounted,
    toCheck,
    extraOpen,
    met,
    latest: all[all.length - 1],
    withheld: withheld?.decision === 'withheld' ? withheld : undefined,
  };
}

/** Three comparable results in a row with no change (plan/02 §2.11). */
export function plateau(counted: BenchmarkResult[], benchmarkId: string, areaId: string): { count: number; value: string } | null {
  const list = counted.filter((r) => r.benchmarkId === benchmarkId && r.areaId === areaId).sort((a, b) => b.date.localeCompare(a.date));
  if (list.length < 3) return null;
  const [a, b, c] = list;
  if (!sameConditions(a, b) || !sameConditions(a, c)) return null;
  const text = (r: BenchmarkResult) => resultLines(r.values).map((l) => l.text).join(' · ');
  if (text(a) === text(b) && text(a) === text(c)) return { count: 3, value: text(a) };
  return null;
}
