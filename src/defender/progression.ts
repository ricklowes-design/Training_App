import type { MetricObservation } from '../db/types';

// Reaction-mode progression (task 3.6). The defender starts with commits and holds and adds
// one mode at a time: after two blocks on different days at the current level with at least
// 75% right responses. Only verified counts (a parent's tally; camera numbers once validated)
// move the level; estimates never do.

export const START_LEVEL = 1; // commits and holds: a real decision from the first block
export const PASS_SHARE = 0.75;

export const levelTag = (level: number) => `modes:${level}`;

export function reactionModeLevel(obs: MetricObservation[], progression: string[], eligible: (drillId: string | undefined, metricId: string) => boolean = () => true): number {
  const max = progression.length - 1;
  let level = START_LEVEL;
  const days = new Map<number, Set<string>>();
  const sorted = obs
    .filter((o) => o.metricId === 'correctResponseByDefenderAction' && o.status === 'verified' && o.value !== undefined && o.unit && eligible(o.contextKey.drillId, o.metricId))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  for (const o of sorted) {
    const at = /^modes:(\d+)$/.exec(o.contextKey.settings ?? '');
    if (!at || Number(at[1]) !== level) continue;
    const of = Number(o.unit!.replace('/', ''));
    if (!(of > 0) || o.value! / of < PASS_SHARE) continue;
    const d = new Date(o.recordedAt);
    const set = days.get(level) ?? new Set<string>();
    set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    days.set(level, set);
    if (set.size >= 2 && level < max) level++;
  }
  return Math.min(level, max);
}

export function allowedModesAt(level: number, progression: string[]): string[] {
  return progression.slice(0, level + 1);
}
