import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Y4M files for Chromium's fake webcam (--use-file-for-fake-video-capture), looped by Chrome.
// "moving": a square sweeps across the lower lane every frame, and a bright bar flashes in the
// tripwire strip (y 55–62%) for half a second every 4 seconds. "still": a fixed picture.

const W = 320;
const H = 180;
const FPS = 30;

function write(name: string, frames: number, draw: (f: number, y: Uint8Array) => void): string {
  const path = join(tmpdir(), `home-training-${name}.y4m`);
  if (existsSync(path)) return path;
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
  const parts: Buffer[] = [header];
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  for (let f = 0; f < frames; f++) {
    const y = new Uint8Array(W * H);
    // Textured background so the framing check has something to match.
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) y[r * W + c] = 90 + Math.round(40 * Math.sin(c / 9) + 30 * Math.cos(r / 7));
    draw(f, y);
    parts.push(Buffer.from('FRAME\n'), Buffer.from(y), uv);
  }
  writeFileSync(path, Buffer.concat(parts));
  return path;
}

const rect = (y: Uint8Array, x0: number, y0: number, w: number, h: number, v: number) => {
  for (let r = Math.max(0, y0); r < Math.min(H, y0 + h); r++) for (let c = Math.max(0, x0); c < Math.min(W, x0 + w); c++) y[r * W + c] = v;
};

export const movingVideo = () =>
  write('moving', 4 * FPS, (f, y) => {
    rect(y, ((f * 12) % (W + 40)) - 40, 140, 40, 30, 250); // sweeping square in the lower lane
    if (f % (4 * FPS) < FPS / 2) rect(y, 70, Math.round(H * 0.55), 180, Math.round(H * 0.07), 255); // tripwire flash
  });

export const stillVideo = () => write('still', 2, () => undefined);

/** A colour still: green floor below a grey wall, with four orange cones in a square (for cone detection). */
export const conesVideo = () => {
  const path = join(tmpdir(), 'home-training-cones.y4m');
  if (existsSync(path)) return path;
  const rgb = (c: number, r: number): [number, number, number] => {
    for (const [cx, by] of [[110, 150], [210, 150], [130, 110], [190, 110]]) {
      if (r <= by && r >= by - 10 && Math.abs(c - cx) <= (r - (by - 10)) / 2 + 1) return [235, 115, 25];
    }
    return r < 70 ? [150 + ((c * 7 + r * 3) % 30), 150, 150] : [60 + ((c * 5 + r * 3) % 20), 110, 70];
  };
  const y = Buffer.alloc(W * H);
  const u = Buffer.alloc((W / 2) * (H / 2));
  const v = Buffer.alloc((W / 2) * (H / 2));
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const [R, G, B] = rgb(c, r);
      y[r * W + c] = Math.round(0.299 * R + 0.587 * G + 0.114 * B);
      if (r % 2 === 0 && c % 2 === 0) {
        const k = (r / 2) * (W / 2) + c / 2;
        u[k] = Math.max(0, Math.min(255, Math.round(-0.169 * R - 0.331 * G + 0.5 * B + 128)));
        v[k] = Math.max(0, Math.min(255, Math.round(0.5 * R - 0.419 * G - 0.081 * B + 128)));
      }
    }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, u, v]);
  writeFileSync(path, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`), frame, frame]));
  return path;
};
