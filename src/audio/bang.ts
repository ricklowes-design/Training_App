// The ball hitting the wall, heard through the microphone (wall drills, parent request 2026-10-28).
// Only the loudness of short frames is looked at, live; no sound is recorded, kept or sent.

export interface OnsetState {
  floor: number; // running background level (RMS)
  lastBangMs: number;
}

export const BANG = { minPeak: 0.22, overFloor: 6, refractoryMs: 600, floorAlpha: 0.05 };

export const initOnset = (): OnsetState => ({ floor: 0.01, lastBangMs: -Infinity });

/** One frame of samples (−1..1) at time tMs: is it a bang (a sharp, loud transient over the room's background)? */
export function onsetFrame(s: OnsetState, samples: ArrayLike<number>, tMs: number, quiet = false): { state: OnsetState; bang: boolean } {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  const bang = !quiet && peak >= BANG.minPeak && peak >= BANG.overFloor * s.floor && tMs - s.lastBangMs >= BANG.refractoryMs;
  // The background follows quiet frames only, so a run of bangs does not raise it.
  const floor = bang ? s.floor : Math.max(0.002, s.floor + BANG.floorAlpha * (rms - s.floor));
  return { state: { floor, lastBangMs: bang ? tMs : s.lastBangMs }, bang };
}

/** Listens to the microphone and calls onBang for each bang; returns a stop function. */
export async function listenForBangs(onBang: (atPerfMs: number) => void, isOutputBusy: () => boolean): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
  let ctx: AudioContext;
  let an: AnalyserNode;
  try {
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
  } catch (e) {
    // Never leave the microphone on when listening could not start (audit task 17).
    stream.getTracks().forEach((x) => x.stop());
    throw e;
  }
  const buf = new Float32Array(an.fftSize);
  let st = initOnset();
  const t = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    const now = performance.now();
    const r = onsetFrame(st, buf, now, isOutputBusy());
    st = r.state;
    if (r.bang) onBang(now);
  }, 15);
  return () => {
    clearInterval(t);
    stream.getTracks().forEach((x) => x.stop());
    void ctx.close();
  };
}
