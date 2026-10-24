import type { ContentBlock, Drill, Programme } from '../content/types';
import type { CueDrillOverride, CustomDrill, Override } from '../db/types';

// Coach changes are overrides stored on the device; the content file is never edited (plan/06 §6.4).

export const DRILL_FIELDS = ['name', 'purpose', 'setupText', 'prescription', 'cues', 'commonErrors', 'mode', 'demo'] as const;
export type DrillField = (typeof DRILL_FIELDS)[number];

export const activeOverrides = (overrides: Override[]) =>
  overrides.filter((o) => !o.revertedAt).sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));

export function applyOverrides(p: Programme, overrides: Override[], customDrills: CustomDrill[] = [], cueDrills: CueDrillOverride[] = []): Programme {
  const drills: Drill[] = [...p.drills.map((d) => ({ ...d, demo: { ...d.demo } })), ...customDrills.map((c) => ({ ...c.drill }))];
  const sessions = p.sessions.map((s) => ({ ...s, blocks: [...s.blocks] }));
  for (const o of activeOverrides(overrides)) {
    if (o.target.kind === 'drill') {
      const d = drills.find((x) => x.id === o.target.id);
      if (!d || !(DRILL_FIELDS as readonly string[]).includes(o.field)) continue;
      if (o.field === 'demo') d.demo = { ...d.demo, ...(o.value as Partial<Drill['demo']>) };
      else (d as unknown as Record<string, unknown>)[o.field] = o.value;
    } else if (o.target.kind === 'session' && o.field === 'blocks') {
      const s = sessions.find((x) => x.id === o.target.id);
      if (s) s.blocks = o.value as ContentBlock[];
    }
  }
  const cues = [...p.cueDrills];
  for (const c of cueDrills) {
    const i = cues.findIndex((x) => x.id === c.id);
    if (i >= 0) cues[i] = c.drill;
    else cues.push(c.drill);
  }
  return { ...p, drills, sessions, cueDrills: cues };
}

/** Current value of a field, for recording previousValue on a new override. */
export function currentValue(p: Programme, target: Override['target'], field: string): unknown {
  if (target.kind === 'drill') {
    const d = p.drills.find((x) => x.id === target.id) as unknown as Record<string, unknown> | undefined;
    return d ? structuredClone(d[field]) : undefined;
  }
  const s = p.sessions.find((x) => x.id === target.id);
  return s ? structuredClone(s.blocks) : undefined;
}
