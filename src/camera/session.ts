import type { CameraSetup, DrillFamily, Pt, RoomProfile } from '../db/types';
import { ROOM_H, ROOM_W, roomConsistency, type RoomCheck } from './roomCheck';
import { OnsetDetector } from './onset';
import { polygonMask, splitMask } from './geometry';
import { framingCheck, motionFraction, toGray, type FramingResult, type Gray } from './frames';

// One camera stream for the whole session: framing check during the demo view,
// recording per block, the presence sampler and the live tripwire. Nothing here
// runs pose; the analysis runs after each block in a worker.

export const SMALL_W = 64;
export const SMALL_H = 36;
const RECORD_BITRATE = 1_500_000; // 720p at 1.5 Mbit/s ≈ 70 MB per 6-minute block
const TRIPWIRE_THRESHOLD = 0.08; // share of tripwire cells changing between frames
const PRESENCE_THRESHOLD = 0.015; // share of the drill area changing between samples

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput');
}

/** The USB webcam if there is one: anything not labelled as built in. */
export function preferredCamera(devices: MediaDeviceInfo[], saved?: string): MediaDeviceInfo | undefined {
  if (saved) {
    const s = devices.find((d) => d.deviceId === saved);
    if (s) return s;
  }
  const builtIn = /integrated|built-in|internal|front|user facing|facetime|hd webcam \(?(04f2|5986|0bda)/i;
  return devices.find((d) => d.label && !builtIn.test(d.label)) ?? devices[devices.length - 1];
}

export async function openStream(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: false,
  });
}

const canvas = () => {
  const c = document.createElement('canvas');
  c.width = SMALL_W;
  c.height = SMALL_H;
  return c;
};

export function smallGray(source: CanvasImageSource, c: HTMLCanvasElement = canvas()): Gray {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, SMALL_W, SMALL_H);
  return toGray(ctx.getImageData(0, 0, SMALL_W, SMALL_H).data, SMALL_W, SMALL_H);
}

/** Grey picture at any size (the room check uses 128×72). */
export function grayAt(source: CanvasImageSource, w: number, h: number): Gray {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  return toGray(ctx.getImageData(0, 0, w, h).data, w, h);
}

export async function blobToSmallGray(blob: Blob): Promise<Gray> {
  const bmp = await createImageBitmap(blob);
  const g = smallGray(bmp);
  bmp.close();
  return g;
}

export async function captureFrame(video: HTMLVideoElement): Promise<{ blob: Blob; width: number; height: number }> {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d')!.drawImage(video, 0, 0);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('capture failed'))), 'image/jpeg', 0.85));
  return { blob, width: c.width, height: c.height };
}

export function familyOf(layoutId: string | undefined): DrillFamily | undefined {
  return layoutId === 'L1' || layoutId === 'L2' || layoutId === 'L3' || layoutId === 'L4' ? layoutId : undefined;
}

interface Masks {
  area: Uint8Array | null;
  tripwire: Uint8Array | null;
  left: Uint8Array | null;
  right: Uint8Array | null;
}

const mask = (poly: Pt[] | undefined) => (poly && poly.length >= 3 ? polygonMask(poly, SMALL_W, SMALL_H) : null);

export class CameraSession {
  stream: MediaStream;
  video: HTMLVideoElement;
  private small = canvas();
  private refs = new Map<number, Gray>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private loopId = 0;
  private prev: Gray | null = null;
  private masks: Masks = { area: null, tripwire: null, left: null, right: null };
  private wasOver = false;
  private sideEnergy: { t: number; l: number; r: number }[] = [];
  /** Latest tripwire crossing (active block ms), read by the cue engine. */
  tripwireMs: number | undefined;
  shapingSide: 'left' | 'right' | undefined;
  presence = { samples: 0, present: 0 };
  /** Live feint onset detector (task 3.3), reset per block. */
  onset = new OnsetDetector();
  private lastPresenceAt = 0;
  private activeMs: () => number = () => 0;

  private constructor(stream: MediaStream, video: HTMLVideoElement) {
    this.stream = stream;
    this.video = video;
  }

  static async open(deviceId?: string): Promise<CameraSession> {
    const stream = await openStream(deviceId);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    return new CameraSession(stream, video);
  }

  close(): void {
    this.stopLoop();
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.stream.getTracks().forEach((t) => t.stop());
  }

  /** Session-launch room check against the active room profile (task 1.3). */
  roomCheck(profile: RoomProfile): RoomCheck | null {
    if (!profile.backgroundThumb || this.video.readyState < 2) return null;
    const ref: Gray = { w: ROOM_W, h: ROOM_H, data: Uint8Array.from(profile.backgroundThumb) };
    return roomConsistency(ref, grayAt(this.video, ROOM_W, ROOM_H), profile.anchors);
  }

  async framing(setup: CameraSetup): Promise<FramingResult> {
    let ref = this.refs.get(setup.id!);
    if (!ref) {
      ref = await blobToSmallGray(setup.referenceFrame);
      this.refs.set(setup.id!, ref);
    }
    if (this.video.readyState < 2) return { ok: false, message: 'Camera is starting…' };
    return framingCheck(ref, smallGray(this.video, this.small));
  }

  /** Starts recording a block and watching the drill area (and tripwire, if any). */
  startBlock(setup: CameraSetup, activeMs: () => number): void {
    this.activeMs = activeMs;
    this.presence = { samples: 0, present: 0 };
    this.tripwireMs = undefined;
    this.shapingSide = undefined;
    this.wasOver = false;
    this.sideEnergy = [];
    this.onset = new OnsetDetector();
    this.prev = null;
    const area = mask(setup.zones[0]?.polygon);
    const [left, right] = area ? splitMask(area, SMALL_W, SMALL_H) : [null, null];
    this.masks = { area, tripwire: mask(setup.tripwire), left, right };
    this.chunks = [];
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime || undefined, videoBitsPerSecond: RECORD_BITRATE });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
    this.startLoop();
  }

  pause(): void {
    if (this.recorder?.state === 'recording') this.recorder.pause();
  }

  resume(): void {
    if (this.recorder?.state === 'paused') this.recorder.resume();
  }

  /** Stops the block's recording. Returns the clip and the share of samples with movement in the drill area. */
  async endBlock(): Promise<{ blob: Blob; mime: string; presenceFrac: number | undefined }> {
    this.stopLoop();
    const rec = this.recorder;
    this.recorder = null;
    if (!rec) return { blob: new Blob(), mime: '', presenceFrac: undefined };
    const done = new Promise<void>((res) => (rec.onstop = () => res()));
    if (rec.state !== 'inactive') rec.stop();
    await done;
    const presenceFrac = this.presence.samples >= 10 ? this.presence.present / this.presence.samples : undefined;
    return { blob: new Blob(this.chunks, { type: rec.mimeType }), mime: rec.mimeType, presenceFrac };
  }

  private startLoop(): void {
    const id = ++this.loopId;
    const step = () => {
      if (id !== this.loopId) return;
      this.onFrame();
      if ('requestVideoFrameCallback' in this.video) this.video.requestVideoFrameCallback(step);
      else setTimeout(step, 33);
    };
    step();
  }

  private stopLoop(): void {
    this.loopId++;
  }

  private onFrame(): void {
    if (this.recorder?.state === 'paused') return;
    const now = this.activeMs();
    const g = smallGray(this.video, this.small);
    const prev = this.prev;
    this.prev = g;
    if (!prev) return;
    // Tripwire: a rising edge of motion in the tripwire zone.
    if (this.masks.tripwire) {
      const m = motionFraction(prev, g, this.masks.tripwire);
      const over = m > TRIPWIRE_THRESHOLD;
      if (over && !this.wasOver) {
        this.tripwireMs = now;
        this.shapingSide = this.recentSide(now);
      }
      this.wasOver = over;
    }
    // Shaping side: motion in the left vs right half of the drill area over the last 300 ms.
    if (this.masks.left && this.masks.right) {
      const l = motionFraction(prev, g, this.masks.left);
      const r = motionFraction(prev, g, this.masks.right);
      this.sideEnergy.push({ t: now, l, r });
      this.onset.feed(now, l, r);
      while (this.sideEnergy.length && this.sideEnergy[0].t < now - 300) this.sideEnergy.shift();
    }
    // Presence, twice a second.
    if (this.masks.area && now - this.lastPresenceAt >= 500) {
      this.lastPresenceAt = now;
      this.presence.samples++;
      if (motionFraction(prev, g, this.masks.area) > PRESENCE_THRESHOLD) this.presence.present++;
    }
  }

  private recentSide(now: number): 'left' | 'right' | undefined {
    const recent = this.sideEnergy.filter((e) => e.t >= now - 300);
    if (!recent.length) return undefined;
    const l = recent.reduce((a, e) => a + e.l, 0);
    const r = recent.reduce((a, e) => a + e.r, 0);
    if (Math.abs(l - r) < 0.01) return undefined;
    return l > r ? 'left' : 'right';
  }
}
