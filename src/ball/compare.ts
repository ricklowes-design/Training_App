import { fitColour, matches, type ColourModel, type Hsv } from './colour';
import type { Capture } from './register';

// Ball check (part 17 BR-01, before the first drills): the parent shows each ball they have to the
// webcam; the ball the camera can tell apart from this room best is recommended. Only the colour
// separation from the room is judged here; the full registration of the chosen ball follows.

export interface BallTry {
  name: string;
  captures: Capture[];
  /** Taps where no single-colour area the size of a ball was found (multi-coloured or patterned balls). */
  misses: number;
}

export type BallVerdict = 'standsOut' | 'usable' | 'hard' | 'notFound';

export interface BallResult {
  name: string;
  verdict: BallVerdict;
  /** Share of the room's pixels that look like the ball (lower is better). */
  backgroundMatchShare?: number;
  colour?: ColourModel;
  text: string;
}

const STANDS_OUT = 0.01;
const USABLE = 0.03;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function judgeBall(t: BallTry, background: Hsv[]): BallResult {
  if (!t.captures.length) {
    return { name: t.name, verdict: 'notFound', text: 'The camera could not find one solid colour on this ball. A ball that is mostly one bright colour is easier to follow.' };
  }
  const colour = fitColour(t.captures.flatMap((c) => c.pixels.filter((_, i) => i % 3 === 0)));
  const share = background.length ? background.filter((p) => matches(colour, p)).length / background.length : 1;
  const verdict: BallVerdict = share <= STANDS_OUT ? 'standsOut' : share <= USABLE ? 'usable' : 'hard';
  const text =
    verdict === 'standsOut'
      ? `Stands out well: ${pct(share)} of the room looks like it.`
      : verdict === 'usable'
        ? `Usable: ${pct(share)} of the room looks like it.`
        : `Hard to follow here: ${pct(share)} of the room looks like it (floor or furniture of a similar colour).`;
  return { name: t.name, verdict, backgroundMatchShare: Math.round(share * 1000) / 1000, colour, text };
}

/** Results best first, and the recommended ball (none when no ball separates from the room well enough). */
export function rankBalls(tries: BallTry[], background: Hsv[]): { results: BallResult[]; recommended?: string } {
  const order: Record<BallVerdict, number> = { standsOut: 0, usable: 1, hard: 2, notFound: 3 };
  const results = tries
    .map((t) => judgeBall(t, background))
    .sort((a, b) => order[a.verdict] - order[b.verdict] || (a.backgroundMatchShare ?? 1) - (b.backgroundMatchShare ?? 1) || (b.colour?.s ?? 0) - (a.colour?.s ?? 0));
  const best = results[0];
  return { results, recommended: best && (best.verdict === 'standsOut' || best.verdict === 'usable') ? best.name : undefined };
}
