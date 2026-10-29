import { footageStats, type FootageStats } from '../domain/systemTest';

// Samples a block's clip for the system test report: a few small grey frames spread through the
// recording, measured for brightness, blur and movement. Runs on the parent's report screen only.

const W = 96;
const H = 54;

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    const done = () => (v.removeEventListener('seeked', done), res());
    v.addEventListener('seeked', done);
    v.currentTime = t;
    setTimeout(done, 1500);
  });
}

export async function sampleFootage(blob: Blob, count = 12): Promise<FootageStats | undefined> {
  if (!blob.size) return undefined;
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.src = url;
  try {
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error('clip could not be read'));
    });
    // MediaRecorder clips often report no duration until the end has been seeked to.
    if (!Number.isFinite(v.duration)) await seek(v, 1e7);
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    if (!dur) return undefined;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const frames: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      await seek(v, (dur * (i + 0.5)) / count);
      ctx.drawImage(v, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      const g = new Uint8Array(W * H);
      for (let k = 0; k < g.length; k++) g[k] = (d[4 * k] * 299 + d[4 * k + 1] * 587 + d[4 * k + 2] * 114) / 1000;
      frames.push(g);
    }
    return footageStats(frames, W, H);
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}
