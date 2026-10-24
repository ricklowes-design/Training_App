import type { Programme } from '../content/types';
import type { Settings } from '../db/types';

export interface ComponentGate {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

/** Each capstone component passes only with enough parent-validated reps at the required agreement (task 5.5). */
export function capstoneGates(p: Programme, settings: Pick<Settings, 'validations'>): { open: boolean; gates: ComponentGate[] } {
  const gates = p.capstone.components.map((c) => {
    const v = settings.validations?.[c.id];
    if (!v) return { id: c.id, label: c.label, passed: false, detail: 'not validated yet' };
    const agreement = v.reps ? v.agreed / v.reps : 0;
    const passed = v.reps >= c.minReps && agreement >= c.minAgreement;
    return { id: c.id, label: c.label, passed, detail: `${v.agreed}/${v.reps} agreed (${Math.round(agreement * 100)}%, needs ${Math.round(c.minAgreement * 100)}% over ${c.minReps}+)` };
  });
  return { open: gates.every((g) => g.passed), gates };
}

/** Whether a camera measure has passed its validation, so its numbers may be shown as verified rather than estimates. */
export function isValidated(p: Programme, settings: Pick<Settings, 'validations'>, componentId: string): boolean {
  return capstoneGates(p, settings).gates.find((g) => g.id === componentId)?.passed ?? false;
}
