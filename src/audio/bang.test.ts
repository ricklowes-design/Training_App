import { describe, expect, it } from 'vitest';
import { initOnset, onsetFrame } from './bang';

const frame = (amp: number, n = 512) => Array.from({ length: n }, (_, i) => (i % 2 ? amp : -amp) * (0.6 + 0.4 * Math.sin(i)));
const thud = (n = 512) => Array.from({ length: n }, (_, i) => (i < 60 ? 0.7 : 0.01) * (i % 2 ? 1 : -1));

describe('ball hitting the wall (microphone onset)', () => {
  it('hears a sharp thud over a quiet room, once', () => {
    let s = initOnset();
    const bangs: number[] = [];
    for (let t = 0; t < 2000; t += 15) {
      const r = onsetFrame(s, t === 990 || t === 1005 ? thud() : frame(0.01), t);
      s = r.state;
      if (r.bang) bangs.push(t);
    }
    expect(bangs).toEqual([990]); // the next frame of the same thud is within the refractory time
  });

  it('ignores steady noise, and anything while the app itself is speaking or beeping', () => {
    let s = initOnset();
    let n = 0;
    for (let t = 0; t < 3000; t += 15) {
      const r = onsetFrame(s, frame(0.08), t); // a loud but steady room (fan, music)
      s = r.state;
      if (r.bang) n++;
    }
    expect(n).toBeLessThanOrEqual(1); // at most the very first frame before the floor settles
    expect(onsetFrame(initOnset(), thud(), 5000, true).bang).toBe(false);
  });

  it('two kicks a second apart are two bangs', () => {
    let s = initOnset();
    const bangs: number[] = [];
    for (let t = 0; t < 3000; t += 15) {
      const r = onsetFrame(s, t === 600 || t === 1605 ? thud() : frame(0.01), t);
      s = r.state;
      if (r.bang) bangs.push(t);
    }
    expect(bangs).toEqual([600, 1605]);
  });
});
