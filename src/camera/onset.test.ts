import { describe, expect, it } from 'vitest';
import { OnsetDetector } from './onset';

/** 30 fps samples: quiet, then a lateral movement to one side starting at onsetMs. */
function series(onsetMs: number | null, side: 'left' | 'right' | 'both', noise = 0.003) {
  const out: [number, number, number][] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * noise;
  for (let t = 0; t <= 3000; t += 33) {
    const on = onsetMs !== null && t >= onsetMs && t < onsetMs + 500;
    const big = 0.12;
    const l = 0.005 + rnd() + (on && (side === 'left' || side === 'both') ? big : on ? 0.01 : 0);
    const r = 0.005 + rnd() + (on && (side === 'right' || side === 'both') ? big : on ? 0.01 : 0);
    out.push([t, Math.max(0, l), Math.max(0, r)]);
  }
  return out;
}

describe('live onset detector (task 3.3)', () => {
  it('finds the onset within a frame or two and the direction', () => {
    const d = new OnsetDetector();
    let hit = null;
    for (const [t, l, r] of series(1500, 'left')) hit = d.feed(t, l, r) ?? hit;
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.onsetMs - 1500)).toBeLessThanOrEqual(66);
    expect(hit!.pictureSide).toBe('left');
    expect(hit!.reportMs - hit!.onsetMs).toBeLessThan(250);
  });

  it('a quiet lane gives no trigger (false positives on control footage)', () => {
    const d = new OnsetDetector();
    let hits = 0;
    for (const [t, l, r] of series(null, 'left', 0.004)) if (d.feed(t, l, r)) hits++;
    expect(hits).toBe(0);
  });

  it('symmetric movement (no clear direction) is not confident: planned timing takes over', () => {
    const d = new OnsetDetector();
    let hit = null;
    for (const [t, l, r] of series(1500, 'both')) hit = d.feed(t, l, r) ?? hit;
    expect(hit).toBeNull();
  });
});
