import { localiseText } from '../domain/units';
import { useMemo } from 'react';
import { APP_VERSION, useData, type AppData } from '../app/data';
import type { Route } from '../app/nav';
import { evaluateRule, ruleFor, type RuleStatus } from '../domain/advancement';
import { anchorPlan, baselinePlan, findSession, repeatPlan, standardPlan, type RunPlan } from '../domain/plans';
import { countedResults } from '../domain/records';
import { areaProgress, confirmedStage, suggestNext, type AreaProgress, type Suggestion } from '../domain/sequencing';
import { trialSuggestion, type TrialSuggestion } from '../domain/trial';
import { layoutFit } from '../domain/room';

export function useAreaProgress(): AreaProgress[] {
  const { programme: p, placements, records, advancements } = useData();
  return useMemo(
    () => p.areas.map((a) => areaProgress(p, a.id, placements.find((x) => x.areaId === a.id), records, advancements)),
    [p, placements, records, advancements],
  );
}

export function useSuggestion(): Suggestion | null {
  const { programme, placements, records, advancements, settings } = useData();
  return useMemo(
    () => suggestNext({ programme, placements, records, advancements, now: new Date(), weekStartDay: settings.weekStartDay, priorities: settings.priorities, allocation: settings.allocation }),
    [programme, placements, records, advancements, settings.weekStartDay, settings.priorities, settings.allocation],
  );
}

export function planForSuggestion(d: AppData, s: Suggestion): RunPlan | null {
  const p = d.programme;
  if (s.kind === 'baseline') return baselinePlan(p, s.areaId);
  const session = findSession(p, s.areaId, s.sessionNumber);
  if (!session) return null;
  if (s.kind === 'repeatForCriteria') return repeatPlan(p, session);
  return standardPlan(p, session, { partner: d.settings.partnerAvailable });
}

export function trialFor(d: AppData, plan: RunPlan): TrialSuggestion {
  const drillIds = plan.blocks.map((b) => b.drillId).filter((x): x is string => !!x);
  return trialSuggestion({ drillIds, records: d.records, settings: d.settings, appVersion: APP_VERSION, contentVersion: d.programme.version, now: new Date() });
}

export function runRoute(d: AppData, plan: RunPlan, trial: boolean): Route {
  return { name: 'run', plan, trial, trialReasons: trialFor(d, plan).reasons };
}

export function anchorDue(d: AppData): { due: boolean; lastDate?: string } {
  const last = d.records
    .filter((r) => r.kind === 'anchor' && (r.status === 'completed' || r.status === 'completedBenchmarkSkipped') && !r.trial)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!last) return { due: true };
  const days = (Date.now() - new Date(last.date).getTime()) / 86_400_000;
  return { due: days >= d.programme.anchorCheck.everyDays, lastDate: last.date };
}

export function anchorRun(d: AppData): RunPlan {
  return anchorPlan(d.programme);
}

/** The advancement rule the area is working toward now, with its status. */
export function ruleStatusFor(d: AppData, areaId: string): RuleStatus | null {
  const p = d.programme;
  const placement = d.placements.find((x) => x.areaId === areaId);
  const stage = confirmedStage(p, areaId, placement, d.advancements);
  if (!stage) return null;
  const exitDone = d.advancements.some((a) => a.areaId === areaId && a.to === 'exit' && a.decision === 'confirmed');
  if (exitDone) return null;
  const rule = ruleFor(p, areaId, stage);
  if (!rule) return null;
  return evaluateRule(p, rule, countedResults(d.results, d.records), d.transfers, d.extraCriteria, d.advancements);
}

/** A month since the last backup, or never backed up once there is at least one session. */
export const backupDue = (d: AppData) =>
  d.settings.backupReminder && (d.settings.lastBackupAt ? Date.now() - new Date(d.settings.lastBackupAt).getTime() > 30 * 86_400_000 : d.records.length > 0);

/** Why a plan cannot run in the current room (a drill's layout exceeds the safe floor), or null (task 1.4). */
export function planRoomFit(d: AppData, plan: RunPlan): string | null {
  const p = d.programme;
  if (!d.layout) return null;
  for (const b of plan.blocks) {
    const layoutId = b.drillId ? p.drills.find((x) => x.id === b.drillId)?.layoutId : b.anchorId ? p.anchors.find((a) => a.id === b.anchorId)?.layoutId : undefined;
    if (!layoutId) continue;
    const fit = layoutFit(layoutId, d.layout.derived, p.layoutGeometry, d.layout.cones);
    if (!fit.ok) return `Not available in this room: ${p.layouts[layoutId]?.name ?? layoutId} — ${localiseText(fit.reason ?? '', d.settings.units)}. A parent can choose another room profile.`;
  }
  return null;
}
