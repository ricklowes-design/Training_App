import type { CueLogEntry } from '../cue/engine';

// Optional digit diagnostic by voice (part 15 D8, experimental, off by default). Chrome's speech
// recognition is online (audio goes to Google's service), so it runs only when the parent turned
// it on. What it hears is a starting estimate for the result card, never a score on its own.

const WORDS: Record<string, number> = {
  one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, tree: 3, free: 3, four: 4, for: 4, fore: 4, five: 5, six: 6, sex: 6, seven: 7, eight: 8, ate: 8, nine: 9, nein: 9,
};

/** Digits 1–9 in what was heard, in order ("seven", "7", "for" → 4). */
export function parseDigits(transcript: string): number[] {
  const out: number[] = [];
  for (const tok of transcript.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!tok) continue;
    if (/^[1-9]$/.test(tok)) out.push(Number(tok));
    else if (/^[1-9]+$/.test(tok) && tok.length <= 3) for (const ch of tok) out.push(Number(ch));
    else if (WORDS[tok] !== undefined) out.push(WORDS[tok]);
  }
  return out;
}

export interface Heard {
  tMs: number; // active block time when the result arrived
  digit: number;
}

export const CALL_WINDOW_MS = 4000;

/** Per rep: the first digit heard after the cue (within the window, before the next rep) against the
 *  number shown. Only the first `limit` reps with a number count, matching the card (/10). */
export function scoreDigits(log: CueLogEntry[], heard: Heard[], limit = 10): { correct: number; heardReps: number; reps: number } {
  const reps = log.filter((e) => e.number !== undefined && e.cueMs !== undefined).slice(0, limit);
  let correct = 0;
  let heardReps = 0;
  for (const e of reps) {
    const next = log.find((x) => x.rep === e.rep + 1)?.repStartMs ?? Infinity;
    const h = heard.find((x) => x.tMs >= e.cueMs! && x.tMs <= Math.min(e.cueMs! + CALL_WINDOW_MS, next));
    if (!h) continue;
    heardReps++;
    if (h.digit === e.number) correct++;
  }
  return { correct, heardReps, reps: reps.length };
}

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

/** Listens for digits while a block runs; restarts itself when Chrome ends a recognition session. */
export class DigitListener {
  readonly heard: Heard[] = [];
  error: string | undefined;
  private rec: Recognition | null = null;
  private on = false;

  constructor(private clock: () => number) {}

  start(): boolean {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      this.error = 'speech recognition not available in this browser';
      return false;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-GB';
    rec.onresult = (ev) => {
      const t = this.clock();
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) continue;
        for (const digit of parseDigits(ev.results[i][0].transcript)) this.heard.push({ tMs: t, digit });
      }
    };
    rec.onerror = (ev) => {
      this.error = ev.error;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') this.on = false;
    };
    rec.onend = () => {
      if (this.on) {
        try {
          rec.start();
        } catch {
          // already restarting
        }
      }
    };
    this.rec = rec;
    this.on = true;
    try {
      rec.start();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    }
    return true;
  }

  stop(): void {
    this.on = false;
    this.rec?.stop();
  }
}
