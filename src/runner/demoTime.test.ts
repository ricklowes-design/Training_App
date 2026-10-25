import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { fmtTime, linkStart, parseTime, watchUrl, youtubeId } from './DemoVideo';

describe('demo video parts', () => {
  it('reads times as seconds, m:ss or 1m23s', () => {
    expect(parseTime('83')).toBe(83);
    expect(parseTime('1:23')).toBe(83);
    expect(parseTime('1m23s')).toBe(83);
    expect(parseTime('45s')).toBe(45);
    expect(parseTime('')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(fmtTime(83)).toBe('1:23');
    expect(fmtTime(5)).toBe('0:05');
  });

  it('takes the start from a pasted link and links back to it', () => {
    expect(linkStart('https://youtu.be/abcdefghijk?t=95')).toBe(95);
    expect(linkStart('https://www.youtube.com/watch?v=abcdefghijk&t=1m35s')).toBe(95);
    expect(linkStart('https://www.youtube.com/watch?v=abcdefghijk')).toBeUndefined();
    expect(watchUrl('abcdefghijk', 95)).toBe('https://www.youtube.com/watch?v=abcdefghijk&t=95s');
  });

  it('every suggested video is a valid YouTube link, labelled unverified, with its alternatives', () => {
    const p = loadProgramme();
    const linked = p.drills.filter((d) => d.demo.type === 'youtube');
    expect(linked.length).toBeGreaterThanOrEqual(15);
    for (const d of linked) {
      expect(youtubeId(d.demo.ref), d.id).toMatch(/^[\w-]{11}$/);
      expect(d.demo.status).toMatch(/unverified|checked by a parent|usable, not great/);
      expect(d.demo.title).toBeTruthy();
      expect(d.demo.alternatives?.[0].ref).toBe(d.demo.ref);
      for (const a of d.demo.alternatives ?? []) expect(youtubeId(a.ref)).toMatch(/^[\w-]{11}$/);
    }
  });
});
