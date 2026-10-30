import type { Programme } from '../content/types';
import type { Advancement, BenchmarkResult, ExtraCriterion, MetricObservation, Placement, SessionRecord, TransferObs } from '../db/types';
import { evaluateRule, evidenceOk, ruleFor } from './advancement';
import { leftPctOfRight, resultLines } from './metrics';
import { sameConditions } from './comparability';
import { trend } from '../learning/trend';
import { countedResults, countsForWeek } from './records';
import { confirmedStage } from './sequencing';

// Next-drill recommendation, explained (task 5.3, part 16 §8): the weaker link in words,
// from recent valid comparable results, the weaker-foot gap, uncertainty and spacing.
// Never a combined score shown to the player; the reasons are what is shown.

export interface RecInput {
  programme: Programme;
  placements: Placement[];
  records: SessionRecord[];
  results: BenchmarkResult[];
  advancements: Advancement[];
  transfers: TransferObs[];
  extraCriteria: ExtraCriterion[];
  observations: MetricObservation[];
  now: Date;
  allocation?: Record<string, number>;
  weekStart?: Date;
}

export function reasonsFor(i: RecInput, areaId: string): string[] {
  const p = i.programme;
  const out: string[] = [];
  const counted = countedResults(i.results, i.records).filter((r) => r.areaId === areaId);
  const valid = counted.filter(evidenceOk);
  const last = [...valid].sort((a, b) => b.date.localeCompare(a.date))[0];
  // Weaker foot.
  const pct = last ? leftPctOfRight(last.values) : undefined;
  if (pct !== undefined && pct < 80) out.push(`left foot at ${Math.round(pct)}% of right on the last ${p.benchmarks.find((b) => b.id === last!.benchmarkId)?.name ?? 'test'}`);
  // Stage criteria still open.
  const stage = confirmedStage(p, areaId, i.placements.find((x) => x.areaId === areaId), i.advancements);
  const rule = stage ? ruleFor(p, areaId, stage) : undefined;
  if (rule) {
    const st = evaluateRule(p, rule, countedResults(i.results, i.records), i.transfers, i.extraCriteria, i.advancements);
    if (!st.met && st.needed) out.push(`stage criteria met on ${st.qualifying} of ${st.needed} required day${st.needed === 1 ? '' : 's'}`);
  }
  // Defender decisions: the weaker of reading and control, where both were counted.
  const defs = i.observations.filter((o) => p.drills.find((d) => d.id === o.contextKey.drillId)?.areaId === areaId && o.status !== 'unableToAssess');
  const lastOf = (m: string) => [...defs].filter((o) => o.metricId === m).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  const read = lastOf('correctResponseByDefenderAction');
  const clean = lastOf('controlledExit');
  if (read && clean && read.value !== undefined && clean.value !== undefined) {
    out.push(read.value < clean.value ? 'reads of the defender lag behind ball control' : clean.value < read.value ? 'chose well but lost the ball more often' : 'reading and control level');
  }
  // Trend over recent comparable valid results (task 7.6), with the count it rests on.
  if (last) {
    const comparable = valid.filter((r) => sameConditions(r, last)).sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
    const line = resultLines(last.values)[0];
    const series = comparable.map((r) => resultLines(r.values).find((l) => l.key === line.key)).filter((l): l is NonNullable<typeof l> => !!l);
    const vals = series.map((l) => (l.timeS !== undefined ? l.timeS : l.score)).filter((v): v is number => v !== undefined);
    const tr = trend(vals, line.timeS === undefined);
    // Descriptive only: "improving" needs an approved, metric-specific repeatability rule (Brief R09).
    const word = { improving: 'recent results better than earlier ones', deteriorating: 'recent results below earlier ones', stable: 'results level' } as const;
    if (tr.trend !== 'insufficient') out.push(`${p.benchmarks.find((b) => b.id === last.benchmarkId)?.name ?? last.benchmarkId}: ${word[tr.trend]} across ${tr.n} comparable tests`);
  }
  // Uncertainty: nothing recent to go on is a reason to observe, never a penalty.
  const lastDate = last ? new Date(last.date) : undefined;
  if (!lastDate || (i.now.getTime() - lastDate.getTime()) / 86_400_000 > 21) out.push('no recent comparable result');
  // Weekly allocation, when the shares are not all equal (task 5.3).
  const shares = Object.values(i.allocation ?? {});
  if (i.weekStart && shares.some((x) => x !== 1)) {
    const total = p.areas.reduce((n, a) => n + Math.max(0.25, i.allocation?.[a.id] ?? 1), 0);
    const pct = Math.round((100 * Math.max(0.25, i.allocation?.[areaId] ?? 1)) / total);
    const done = i.records.filter((r) => r.areaId === areaId && countsForWeek(r) && new Date(r.date) >= i.weekStart!).length;
    out.push(`set to ${pct}% of the week; ${done} session${done === 1 ? '' : 's'} so far this week`);
  }
  // Spacing.
  const lastSession = i.records.filter((r) => r.areaId === areaId && countsForWeek(r)).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (lastSession) {
    const days = Math.floor((i.now.getTime() - new Date(lastSession.date).getTime()) / 86_400_000);
    if (days >= 4) out.push(`last practised ${days} days ago`);
  } else out.push('not practised yet');
  return out;
}
