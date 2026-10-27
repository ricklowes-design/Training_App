import type { VoiceStyle } from '../content/types';
import type { SoundSettings } from '../db/types';

// Spoken cues (speechSynthesis) and tones (Web Audio). Everything that happens
// inside a block is announced, so the player never needs to look at the screen.

let ctx: AudioContext | null = null;
let settings: SoundSettings = { tones: true, speech: true, endOfSessionLine: true, volume: 0.9, voiceRate: 0.95 };

let styles: Record<string, VoiceStyle> = {};

export function setSoundSettings(s: SoundSettings, voiceStyles?: Record<string, VoiceStyle>): void {
  settings = s;
  if (voiceStyles) styles = voiceStyles;
}

/** A line as the chosen style says it (the standard words when no rule matches). */
export function styledLine(text: string, style: VoiceStyle | undefined): string {
  for (const l of style?.lines ?? []) {
    let re: RegExp;
    try {
      re = new RegExp(l.match);
    } catch {
      continue;
    }
    if (re.test(text)) return text.replace(re, l.say);
  }
  return text;
}

/** Call from a tap handler: browsers only allow audio after a user gesture. */
export function unlockAudio(): void {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export type ToneKind = 'start' | 'end' | 'tick' | 'warn' | 'cue';

const TONES: Record<ToneKind, { freq: number; ms: number; repeat?: number }> = {
  start: { freq: 880, ms: 350 },
  end: { freq: 523, ms: 700, repeat: 2 },
  tick: { freq: 660, ms: 120 },
  warn: { freq: 740, ms: 200, repeat: 2 },
  cue: { freq: 1046, ms: 250 },
};

export function tone(kind: ToneKind): void {
  if (!settings.tones || !ctx) return;
  const t = TONES[kind];
  const reps = t.repeat ?? 1;
  for (let i = 0; i < reps; i++) {
    const at = ctx.currentTime + i * ((t.ms + 120) / 1000);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = t.freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(settings.volume, at + 0.01);
    gain.gain.setValueAtTime(settings.volume, at + t.ms / 1000 - 0.03);
    gain.gain.linearRampToValueAtTime(0, at + t.ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + t.ms / 1000 + 0.02);
  }
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (settings.voiceURI) {
    const v = voices.find((x) => x.voiceURI === settings.voiceURI);
    if (v) return v;
  }
  return voices.find((v) => v.lang.startsWith('en') && v.localService) ?? voices.find((v) => v.lang.startsWith('en'));
}

export function say(text: string, opts: { interrupt?: boolean } = {}): void {
  if (!settings.speech || typeof window === 'undefined' || !window.speechSynthesis) return;
  if (opts.interrupt) window.speechSynthesis.cancel();
  const style = settings.voiceStyle ? styles[settings.voiceStyle] : undefined;
  const u = new SpeechSynthesisUtterance(styledLine(text, style));
  u.rate = Math.min(2, settings.voiceRate * (style?.rate ?? 1));
  u.pitch = style?.pitch ?? 1;
  u.volume = settings.volume;
  const v = pickVoice();
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

export function stopSpeech(): void {
  window.speechSynthesis?.cancel();
}

export function listVoices(): SpeechSynthesisVoice[] {
  return (window.speechSynthesis?.getVoices() ?? []).filter((v) => v.lang.startsWith('en'));
}
