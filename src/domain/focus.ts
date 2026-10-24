import type { FocusMetricConfig, Programme } from '../content/types';
import type { BenchmarkResult, SessionRecord } from '../db/types';
import { evidenceOk } from './advancement';
import { lastComparable } from './comparability';
import { compareLine, resultLines } from './metrics';
import { countedResults } from './records';
import { tryFill } from './templates';

// Focus measures (part 16 §6) and the home screen's goals and "last credible improvement" (D14).

export const METRIC_LABELS: Record<string, string> = {
  'M1+M2': 'slalom time with control errors',
  M3: 'head-up digits',
  M4: 'V-pull count',
  M5: 'outside-touch gate',
  M6: 'feint technique rubric',
  M7: 'cue accuracy',
  M8: 'scan decisions',
  M9: 'looks before the touch',
  correctResponseByDefenderAction: 'reading the defender',
  controlledExit: 'clean controlled exit',
  changeOfMindSuccess: 'adapting when the defender changes',
  timeToAppropriateExitMs: 'time to the right exit',
  controlErrors: 'control errors',
  firstTouchControlled: 'controlled first touch',
  targetHit: 'short pass on target',
  lookCount: 'looks while the ball rolls',
  quizCorrect: 'picture quiz',
  transferObservation: 'coach transfer check',
  digitCorrect: 'digit diagnostic',
  lastLookToTouchMs: 'last look to touch',
  possibleEarlyRouteCommitment: 'possible early route commitment',
  reactivitySlope: 'reactivity slope',
  deceptionRatio: 'feint timing ratio',
  estimatedTechnique: 'estimated technique',
};

export const metricLabel = (id: string) => METRIC_LABELS[id] ?? id;

export function focusFor(p: Programme, drillId: string | undefined): FocusMetricConfig | undefined {
  return drillId ? p.focusMetricConfig[drillId] : undefined;
}

/** Only progression-eligible measures can move a stage (task 5.1). */
export function progressionEligible(p: Programme, drillId: string, metricId: string): boolean {
  const f = focusFor(p, drillId);
  return !!f && f.progressionEligible.includes(metricId) && !f.experimental.includes(metricId);
}

/** Today's one or two goals: the focus of the session's first drill, plus a matching coach priority. */
export function todayGoals(p: Programme, drillIds: string[], areaId: string | undefined, priorities: string[]): string[] {
  const goals: string[] = [];
  const first = drillIds.find((d) => p.focusMetricConfig[d]);
  if (first) {
    const drill = p.drills.find((d) => d.id === first);
    const f = p.focusMetricConfig[first];
    goals.push(`${drill?.name ?? first}: ${f.primary.map(metricLabel).join(' and ')}`);
  }
  const area = p.areas.find((a) => a.id === areaId);
  const pri = area?.priorityTags.find((t) => priorities.includes(t));
  if (pri) goals.push(pri);
  return goals.slice(0, 2);
}

/** The most recent counted, comparable improvement backed by evidence (not self-scored alone). */
export function lastCredibleImprovement(p: Programme, results: BenchmarkResult[], records: SessionRecord[]): string | null {
  const counted = countedResults(results, records).filter(evidenceOk);
  const newestFirst = [...counted].sort((a, b) => b.date.localeCompare(a.date) || b.attempt - a.attempt);
  for (const r of newestFirst) {
    const prev = lastComparable(r, counted);
    if (!prev) continue;
    const before = resultLines(prev.values);
    for (const l of resultLines(r.values)) {
      const b = before.find((x) => x.key === l.key);
      if (b && compareLine(l, b) === 'improvement') {
        const name = p.benchmarks.find((x) => x.id === r.benchmarkId)?.name ?? p.anchors.find((a) => a.id === r.benchmarkId)?.name ?? r.benchmarkId;
        const date = new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        return tryFill(p.feedbackTemplates, 'homeImprovement', { metric: `${name} ${l.label.toLowerCase()}`, before: b.text, now: l.text, date });
      }
    }
  }
  return null;
}
