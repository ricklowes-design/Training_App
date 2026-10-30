import { describe, expect, it } from 'vitest';
import { parseProgramme, validateProgramme } from './validate';
import { loadProgramme, programmeText } from '../test/fixtures';

describe('content validation', () => {
  it('accepts the shipped programme', () => {
    const r = parseProgramme(programmeText());
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.programme.drills).toHaveLength(26);
    expect(r.programme.sessions).toHaveLength(64);
  });

  it('reports a JSON typo with its line', () => {
    const text = programmeText().replace(/"version": "[^"]+",/, '"version": "x"');
    const r = parseProgramme(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/not valid JSON/);
  });

  it('names the field that has the wrong type', () => {
    const p = loadProgramme() as unknown as { drills: { cues: unknown }[] };
    p.drills[2].cues = 'one cue';
    const r = validateProgramme(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('drills[2].cues: expected a list, found text "one cue"');
  });

  it('catches a session whose minutes do not add up', () => {
    const p = loadProgramme();
    p.sessions[0].blocks[1].minutes = 7;
    const r = validateProgramme(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/scanning-1: blocks add up to 21 minutes/);
  });

  it('catches a session pointing at a missing drill', () => {
    const p = loadProgramme();
    const b = p.sessions[0].blocks[1];
    if (b.type === 'work') b.drillId = 'Z9';
    const r = validateProgramme(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/drill "Z9" does not exist/);
  });
});

describe('content warnings', () => {
  it('lists stage rules that need fewer than two days, not exit rules', async () => {
    const { contentWarnings } = await import('./validate');
    const { loadProgramme } = await import('../test/fixtures');
    const p = loadProgramme();
    expect(contentWarnings(p)).toEqual([]); // all two days since the owner's decision
    const one = structuredClone(p);
    one.advancementRules.find((r) => r.areaId === 'control' && r.from === 'st2')!.consecutive = 1;
    const w = contentWarnings(one);
    expect(w.length).toBe(1);
    expect(w.every((x) => !x.includes('→exit'))).toBe(true);
    expect(w[0]).toMatch(/needs passes on 1 day; stage advancement usually needs two different days/);
  });
});
