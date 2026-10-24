import { describe, expect, it } from 'vitest';
import type { MetricObservation } from '../db/types';
import { loadProgramme } from '../test/fixtures';
import { allowedModesAt, levelTag, reactionModeLevel, START_LEVEL } from './progression';

const prog = loadProgramme().reactionModesProgression;
const o = (date: string, value: number, level: number, status: MetricObservation['status'] = 'verified'): MetricObservation => ({
  metricId: 'correctResponseByDefenderAction', value, unit: '/16', status, source: 'manual', recordedAt: date, contextKey: { layoutVersion: 1, cueLevel: 'x', settings: levelTag(level) },
});

describe('reaction-mode progression (task 3.6)', () => {
  it('starts with commits and holds', () => {
    expect(reactionModeLevel([], prog)).toBe(START_LEVEL);
    expect(allowedModesAt(START_LEVEL, prog)).toEqual(['commitsToFeint', 'holds']);
  });
  it('adds a mode after two passing blocks on different days', () => {
    expect(reactionModeLevel([o('2026-11-03T10:00', 13, 1), o('2026-11-03T18:00', 14, 1)], prog)).toBe(1);
    expect(reactionModeLevel([o('2026-11-03T10:00', 13, 1), o('2026-11-05T18:00', 14, 1)], prog)).toBe(2);
  });
  it('estimates and failing blocks never move it', () => {
    expect(reactionModeLevel([o('2026-11-03', 15, 1, 'estimate'), o('2026-11-05', 15, 1, 'estimate')], prog)).toBe(1);
    expect(reactionModeLevel([o('2026-11-03', 10, 1), o('2026-11-05', 11, 1)], prog)).toBe(1);
  });
  it('never goes past the last mode', () => {
    const many = Array.from({ length: 20 }, (_, i) => o(`2026-11-${String(i + 1).padStart(2, '0')}T10:00`, 16, Math.floor(i / 2) + 1));
    expect(reactionModeLevel(many, prog)).toBe(prog.length - 1);
  });
});
