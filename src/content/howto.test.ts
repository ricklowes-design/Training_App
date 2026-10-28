import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';

const p = loadProgramme();

describe('player instructions for cue drills', () => {
  const used = new Set([...p.drills.map((d) => d.cueDrillId), ...Object.values(p.benchmarkCueDrills ?? {})].filter(Boolean));
  it('every cue drill in use says what the player will see and what to do for every word', () => {
    for (const c of p.cueDrills.filter((x) => used.has(x.id))) {
      expect(c.howTo, c.id).toBeDefined();
      expect(c.howTo!.expect.length, c.id).toBeGreaterThan(10);
      // Short enough to read from across the room.
      expect(c.howTo!.expect.length, c.id).toBeLessThanOrEqual(60);
      for (const w of Object.values(c.howTo!.words)) expect(w.length, `${c.id}: ${w}`).toBeLessThanOrEqual(45);
      for (const v of c.values ?? []) expect(c.howTo!.words[v], `${c.id} ${v}`).toBeTruthy();
      expect(c.howTo!.say, c.id).toBeTruthy();
    }
  });
  it('every drill that uses a cue has its steps for one rep', () => {
    for (const d of p.drills.filter((x) => x.cueDrillId)) {
      expect(d.steps?.length ?? 0, d.id).toBeGreaterThanOrEqual(3);
      for (const st of [...(d.steps ?? []), ...(d.stepsWall ?? [])]) expect(st.length, `${d.id}: ${st}`).toBeLessThanOrEqual(60);
    }
  });
});

describe('what each cue drill teaches', () => {
  it('every cue drill in use explains its game purpose in a line or two', () => {
    const used = new Set([...p.drills.map((d) => d.cueDrillId), ...Object.values(p.benchmarkCueDrills ?? {})].filter(Boolean));
    for (const c of p.cueDrills.filter((x) => used.has(x.id))) {
      expect(c.howTo?.why?.length ?? 0, c.id).toBeGreaterThan(10);
      expect(c.howTo?.why?.length ?? 0, c.id).toBeLessThanOrEqual(110);
    }
  });
});
