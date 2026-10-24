import type { AdvancementRule, Programme } from '../content/types';
import type { Advancement, BenchmarkResult, ExtraCriterion, TransferObs } from '../db/types';
import { sameConditions } from './comparability';
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
  hasTransfer: boolean;
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

/** Results that can count toward the rule, oldest first, at the latest result's layout. */
export function candidates(rule: AdvancementRule, counted: BenchmarkResult[]): BenchmarkResult[] {
  if (!rule.benchmarkId) return [];
  const list = counted
    .filter((r) => r.benchmarkId === rule.benchmarkId && r.areaId === rule.areaId)
    .filter((r) => !rule.cueLevels || rule.cueLevels.includes(r.conditions.cueLevel))
    .filter((r) => !rule.drillIds || (r.drillId !== undefined && rule.drillIds.includes(r.drillId)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.attempt - b.attempt);
  const last = list[list.length - 1];
  return last ? list.filter((r) => r.conditions.layoutVersion === last.conditions.layoutVersion) : [];
}

/** Results that can count as evidence for stage advancement. */
export const evidenceOk = (r: BenchmarkResult): boolean => r.conditions.recordedBy !== 'self' && !r.flagged;

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function evaluateRule(
  p: Programme,
  rule: AdvancementRule,
  counted: BenchmarkResult[],
  transfers: TransferObs[],
  extra: ExtraCriterion[] = [],
  decisions: Advancement[] = [],
): RuleStatus {
  const all = candidates(rule, counted);
  // Evidence is verified (the app's timer or camera) or scored by a parent/coach; self-scored results don't advance a stage.
  const list = all.filter(evidenceOk);
  const run: BenchmarkResult[] = [];
  for (let i = list.length - 1; i >= 0 && passes(rule, list[i]); i--) run.push(list[i]);
  // Repeated success on different days (part 15 D12): two passes on one day count once.
  const trailing = new Set(run.map((r) => localDay(r.date))).size;
  const selfScoredIgnored = all.filter((r) => !evidenceOk(r) && passes(rule, r)).length;
  const needed = rule.consecutive;
  const hasTransfer = transfers.some((t) => t.areaId === rule.areaId);
  const extraOpen = extra.filter((x) => x.areaId === rule.areaId && x.from === rule.from && !x.metAt);
  const met = trailing >= needed && (!rule.requiresTransfer || hasTransfer) && extraOpen.length === 0;
  const withheld = [...decisions]
    .filter((d) => d.areaId === rule.areaId && d.from === rule.from && d.to === rule.to)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return {
    rule,
    criteriaText: p.advancement[rule.areaId]?.[`${rule.from}->${rule.to}`] ?? '',
    qualifying: Math.min(trailing, needed),
    needed,
    selfScoredIgnored,
    hasTransfer,
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
