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

/** Plain words for the parent, by camera error type (audit 2026-10-29, task 5). */
export function cameraErrorText(e: unknown): string {
  const name = e instanceof DOMException || (e instanceof Error && e.name) ? (e as Error).name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Chrome is blocking the camera. Click the camera icon in the address bar, choose Allow, then reload.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No webcam found. Check the USB cable, then reload.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The webcam is busy. Close the Camera app or any other tab using it, then reload.';
  return `Camera not available (${e instanceof Error && e.message ? e.message : 'unknown error'}).`;
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
  /** Resolves when the current recorder has stopped, listened for from the start (audit task 6). */
  private stopped: Promise<void> = Promise.resolve();
  /** Called once if the camera's video track ends (unplugged, or taken by another app). */
  onEnded?: () => void;
  /** Active block time when the recorder actually started (audit task 16). */
  private startActive: number | undefined;

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
    const cs = new CameraSession(stream, video);
    stream.getVideoTracks()[0]?.addEventListener('ended', () => cs.onEnded?.(), { once: true });
    // Browser tests only (navigator.webdriver): lets a test unplug the camera.
    if (navigator.webdriver) (window as unknown as { __cameraSession?: CameraSession }).__cameraSession = cs;
    return cs;
  }

  /** Opens the saved camera, else the USB webcam, else Chrome's default. `fellBack` is true when the saved one was missing. */
  static async openPreferred(saved?: string): Promise<{ session: CameraSession; fellBack: boolean }> {
    const cam = preferredCamera(await listCameras(), saved);
    try {
      return { session: await CameraSession.open(cam?.deviceId), fellBack: !!saved && cam?.deviceId !== saved };
    } catch (e) {
      if (cam && e instanceof DOMException && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        return { session: await CameraSession.open(undefined), fellBack: true };
      }
      throw e;
    }
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
    const rec = new MediaRecorder(this.stream, { mimeType: mime || undefined, videoBitsPerSecond: RECORD_BITRATE });
    this.recorder = rec;
    // Listen from the start: Chrome can stop the recorder by itself (camera unplugged) before endBlock runs.
    this.stopped = new Promise<void>((res) => rec.addEventListener('stop', () => res(), { once: true }));
    rec.onerror = () => {
      if (rec.state !== 'inactive') rec.stop();
    };
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    // The clip's frame 0 is when recording really began, not when the block became active.
    this.startActive = undefined;
    rec.addEventListener('start', () => (this.startActive = this.activeMs()), { once: true });
    rec.start(1000);
    this.startLoop();
  }

  pause(): void {
    if (this.recorder?.state === 'recording') this.recorder.pause();
  }

  resume(): void {
    if (this.recorder?.state === 'paused') this.recorder.resume();
  }

  /** Stops the block's recording. Returns the clip and the share of samples with movement in the drill area. */
  async endBlock(): Promise<{ blob: Blob; mime: string; presenceFrac: number | undefined; startActiveMs: number }> {
    this.stopLoop();
    const rec = this.recorder;
    this.recorder = null;
    if (!rec) return { blob: new Blob(), mime: '', presenceFrac: undefined, startActiveMs: 0 };
    if (rec.state !== 'inactive') rec.stop();
    // Never wait forever: a recorder that already stopped (or never reports it) gives up after 3 s.
    await Promise.race([this.stopped, new Promise<void>((r) => setTimeout(r, 3000))]);
    const presenceFrac = this.presence.samples >= 10 ? this.presence.present / this.presence.samples : undefined;
    return { blob: new Blob(this.chunks, { type: rec.mimeType }), mime: rec.mimeType, presenceFrac, startActiveMs: Math.max(0, Math.round(this.startActive ?? 0)) };
  }

  private startLoop(): void {
    const id = ++this.loopId;
    const step = (_now?: number, meta?: VideoFrameCallbackMetadata) => {
      if (id !== this.loopId) return;
      // Time the frame was captured, not when the callback ran (audit task 16).
      // Only a plausible lag is used: some cameras report capture times on another clock.
      const lag = meta?.captureTime !== undefined ? performance.now() - meta.captureTime : 0;
      this.onFrame(lag > 0 && lag < 500 ? lag : 0);
      if ('requestVideoFrameCallback' in this.video) this.video.requestVideoFrameCallback(step);
      else setTimeout(step, 33);
    };
    step();
  }

  private stopLoop(): void {
    this.loopId++;
  }

  private onFrame(lagMs = 0): void {
    if (this.recorder?.state === 'paused') return;
    const now = this.activeMs() - lagMs;
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
