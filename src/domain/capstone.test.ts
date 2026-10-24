import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { capstoneGates, isValidated } from './capstone';

const p = loadProgramme();
describe('capstone gating (task 5.5)', () => {
  it('locked until every component is validated with enough reps and agreement', () => {
    expect(capstoneGates(p, {}).open).toBe(false);
    const all = Object.fromEntries(p.capstone.components.map((c) => [c.id, { date: '2026-12-01', reps: 20, agreed: 19 }]));
    expect(capstoneGates(p, { validations: all }).open).toBe(true);
    const few = { ...all, scanProxy: { date: '2026-12-01', reps: 10, agreed: 10 } };
    expect(capstoneGates(p, { validations: few }).open).toBe(false);
    expect(isValidated(p, { validations: few }, 'scanProxy')).toBe(false);
    expect(isValidated(p, { validations: few }, 'onsetDetector')).toBe(true);
  });
});
