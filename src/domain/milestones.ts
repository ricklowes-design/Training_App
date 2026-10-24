import type { Programme } from '../content/types';
import type { Advancement, BenchmarkResult, Milestone, SessionRecord, TransferObs } from '../db/types';
import { leftPctOfRight } from './metrics';
import { areaName } from './plans';
import { countedResults, countsForWeek } from './records';
import { tryFill } from './templates';

// Milestones (plan/05 §5.5): shown once, dated.

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function computeMilestones(
  p: Programme,
  records: SessionRecord[],
  results: BenchmarkResult[],
  advancements: Advancement[],
  transfers: TransferObs[],
): Omit<Milestone, 'shownAt'>[] {
  const t = p.feedbackTemplates;
  const out: Omit<Milestone, 'shownAt'>[] = [];
  const add = (id: string, date: string, text: string | null) => {
    if (text) out.push({ id, date, text });
  };
  const done = records.filter(countsForWeek).sort((a, b) => a.date.localeCompare(b.date));
  for (const a of p.areas) {
    const first = done.find((r) => r.areaId === a.id);
    if (first) add(`first:${a.id}`, first.date, tryFill(t, 'milestoneFirstArea', { area: areaName(p, a.id), date: day(first.date) }));
  }
  if (done.length >= 10) add('ten', done[9].date, tryFill(t, 'milestoneTen', { date: day(done[9].date) }));
  for (const adv of advancements.filter((x) => x.decision === 'confirmed')) {
    const st = p.stages.find((s) => s.id === adv.to);
    add(`stage:${adv.areaId}:${adv.to}`, adv.date, tryFill(t, 'milestoneStage', { area: areaName(p, adv.areaId), to: st?.order ?? adv.to, date: day(adv.date) }));
  }
  const parity = countedResults(results, records)
    .sort((a, b) => a.date.localeCompare(b.date))
    .find((r) => (leftPctOfRight(r.values) ?? 0) >= 80);
  if (parity) {
    const name = p.benchmarks.find((b) => b.id === parity.benchmarkId)?.name ?? p.anchors.find((a) => a.id === parity.benchmarkId)?.name ?? parity.benchmarkId;
    add('parity', parity.date, tryFill(t, 'milestoneParity', { metric: name, pct: Math.round(leftPctOfRight(parity.values) ?? 0), date: day(parity.date) }));
  }
  for (const a of p.areas) {
    const tr = transfers.filter((x) => x.areaId === a.id).sort((x, y) => x.date.localeCompare(y.date))[0];
    if (tr) add(`transfer:${a.id}`, tr.date, tryFill(t, 'milestoneTransfer', { area: areaName(p, a.id), date: day(tr.seenOn || tr.date) }));
  }
  return out;
}
