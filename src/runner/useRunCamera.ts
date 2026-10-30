import { useEffect, useRef, useState } from 'react';
import type { Programme } from '../content/types';
import { currentSetup, familyForBlock } from '../camera/clips';
import type { FramingResult } from '../camera/frames';
import { CameraSession, cameraErrorText } from '../camera/session';
import { isQuota, MIN_FREE_MB_TO_RECORD, storageMB } from '../app/storage';
import { pruneClips } from '../camera/clips';
import type { CueInput, Side } from '../cue/engine';
import type { DefenderInput } from '../defender/block';
import { db } from '../db/db';
import type { BlockResult, CameraSetup, Clip, RoomProfile, Settings } from '../db/types';
import type { RoomCheck } from '../camera/roomCheck';
import type { RunBlock } from '../domain/plans';
import type { RunState } from './engine';

export type BlockExtras = Partial<Pick<BlockResult, 'cueLog' | 'cueLevel' | 'presenceFrac' | 'clipId' | 'clipError' | 'defender' | 'windows' | 'trainingMode' | 'instructionVersion'>>;

const flip = (s: Side): Side => (s === 'left' ? 'right' : 'left');

/** Recording without a camera set-up: no zones or tripwire, so nothing is measured, only the clip kept. */
const REVIEW_ONLY: CameraSetup = { drillFamily: 'L1', deviceId: '', deviceLabel: '', referenceFrame: new Blob(), width: 0, height: 0, zones: [], floorPoints: [], mirror: false, createdAt: '' };

const recordable = (b: RunBlock) => b.kind === 'work' || b.kind === 'benchmark' || b.kind === 'anchor';

/** The camera during a run: framing check in the demo view, a clip per drill block,
 *  presence in the drill area, and the live tripwire for cue blocks (tasks 16 and 18). */
export function useRunCamera(args: {
  programme: Programme;
  settings: Settings;
  setups: CameraSetup[];
  state: RunState;
  stateRef: { current: RunState };
  recordId: (blockIdx: number) => string | null;
  activeMs: () => number;
  setExtras: (key: string, patch: BlockExtras) => void;
  onClip?: (clip: Clip, block: RunBlock, setup: CameraSetup) => void;
  roomProfile?: RoomProfile;
  onRoomCheck?: (r: RoomCheck | null) => void;
}) {
  const { programme: p, settings, setups, state: s, stateRef, recordId, activeMs, setExtras, onClip, roomProfile } = args;
  const [roomCheck, setRoomCheck] = useState<RoomCheck | null>(null);
  // Camera-unverified mode: the camera moved since the room profile, so zones (and presence) cannot be trusted.
  const unverified = useRef(false);
  const session = useRef<CameraSession | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [framing, setFraming] = useState<FramingResult | null>(null);
  const [clipError, setClipError] = useState('');
  // Too little free space: drills are not recorded (checked when the camera opens).
  const noSpace = useRef(false);
  // The webcam was unplugged: reopen it when the next block's instructions show (audit task 6).
  const ended = useRef(false);
  const [reopen, setReopen] = useState(0);
  const recording = useRef<{ key: string; block: RunBlock; setup?: CameraSetup; blockIdx: number; attempt: number } | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const cb = useRef({ onClip, setExtras, recordId });
  cb.current = { onClip, setExtras, recordId };

  // Camera on: every drill block is recorded for watching back. Where the drill area has its camera
  // set-up (zones, floor points), the clip is also analysed and presence is measured.
  const enabled = settings.camera.enabled;
  const block = s.plan.blocks[s.blockIdx];
  const setup = block ? currentSetup(setups, familyForBlock(p, block)) : undefined;

  async function checkSpace() {
    let s0 = await storageMB();
    if (s0 && s0.freeMB < MIN_FREE_MB_TO_RECORD) {
      await pruneClips(settings.camera.retentionDays).catch(() => 0); // try to free space first
      s0 = await storageMB();
    }
    noSpace.current = !!s0 && s0.freeMB < MIN_FREE_MB_TO_RECORD;
    if (noSpace.current) setError('Not enough space to record drills. Parent → Clips can free space.');
  }

  // Open once per run; close at the end.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // The camera the set-up used: the saved one, else the USB webcam (audit 2026-10-29, task 5).
    const saved = settings.camera.deviceId ?? setups.find((x) => x.deviceId)?.deviceId;
    CameraSession.openPreferred(saved)
      .then(({ session: cs, fellBack }) => {
        if (cancelled) return cs.close();
        session.current = cs;
        ended.current = false;
        cs.onEnded = () => {
          // Keep the session until the current block ends, so the clip recorded so far is still saved.
          ended.current = true;
          setLive(false);
          setError('The webcam was disconnected. Plug it back in; the next drill will try again.');
        };
        setLive(true);
        setError('');
        void checkSpace();
        if (fellBack) setError('The webcam chosen in Camera set-up was not found, so another camera is being used. Check the USB cable.');
      })
      .catch((e) => setError(cameraErrorText(e)));
    return () => {
      cancelled = true;
      session.current?.close();
      session.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reopen]);

  useEffect(() => {
    if (enabled && ended.current && s.phase === 'demo' && !recording.current) setReopen((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phase, s.blockIdx]);

  // Session-launch room check against the room profile (task 1.3): once, before the first block.
  useEffect(() => {
    if (!live || !roomProfile?.backgroundThumb) return;
    let tries = 0;
    let stop = false;
    const run = () => {
      if (stop || !session.current) return;
      const r = session.current.roomCheck(roomProfile);
      if (!r && tries++ < 10) return void setTimeout(run, 500);
      unverified.current = r?.status === 'moved';
      setRoomCheck(r);
      args.onRoomCheck?.(r);
    };
    run();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, roomProfile?.id]);

  // Framing check while the demo view is up.
  useEffect(() => {
    setFraming(null);
    if (!live || s.phase !== 'demo' || !setup) return;
    let stop = false;
    const run = async () => {
      if (stop || !session.current) return;
      setFraming(await session.current.framing(setup));
      if (!stop) setTimeout(run, 1000);
    };
    void run();
    return () => {
      stop = true;
    };
  }, [live, s.phase, s.blockIdx, setup]);

  // Start recording when a drill block goes active; stop when it leaves the active phase.
  const key = `${s.blockIdx}:${s.attempt}`;
  useEffect(() => {
    const cs = session.current;
    if (!cs) return;
    const active = s.phase === 'active' && block && recordable(block);
    const rec = recording.current;
    if (rec && (rec.key !== key || s.phase !== 'active')) {
      recording.current = null;
      const done = cs.endBlock().then(async ({ blob, mime, presenceFrac, startActiveMs }) => {
        const extras: BlockExtras = {};
        try {
          if (rec.setup && rec.block.kind === 'work' && presenceFrac !== undefined && !unverified.current) extras.presenceFrac = Math.round(presenceFrac * 100) / 100;
          const sessionRecordId = cb.current.recordId(rec.blockIdx);
          if (blob.size && sessionRecordId) {
            const result = stateRef.current.results.find((r) => r.index === rec.blockIdx && r.attempt === rec.attempt);
            const clip: Clip = {
              id: crypto.randomUUID(),
              blob,
              mime,
              drillId: rec.block.drillId,
              blockLabel: rec.block.drillId ?? rec.block.anchorId ?? rec.block.benchmarkId ?? rec.block.kind,
              sessionRecordId,
              blockIndex: rec.blockIdx,
              attempt: rec.attempt,
              date: new Date().toISOString(),
              durationS: result?.elapsedS ?? 0,
              cameraSetupId: rec.setup?.id,
              startActiveMs,
            };
            try {
              await db.clips.put(clip);
              extras.clipId = clip.id;
              if (rec.setup) cb.current.onClip?.(clip, rec.block, rec.setup);
            } catch (e) {
              // The clip is lost, but never the presence value or the record (audit task 8).
              const why = isQuota(e) ? 'Storage is full, so this drill’s video was not kept.' : 'This drill’s video could not be saved.';
              extras.clipError = why;
              setClipError(why);
            }
          }
        } finally {
          cb.current.setExtras(rec.key, extras);
        }
      });
      pending.current = pending.current.then(() => done).catch(() => undefined);
    }
    if (active && !recording.current && !noSpace.current) {
      recording.current = { key, block, setup, blockIdx: s.blockIdx, attempt: s.attempt };
      setClipError('');
      cs.startBlock(setup ?? REVIEW_ONLY, activeMs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phase, key, live]);

  // Recorder follows PAUSE.
  useEffect(() => {
    if (!recording.current) return;
    if (s.pausedAtMs !== null) session.current?.pause();
    else session.current?.resume();
  }, [s.pausedAtMs]);

  const tripwireAvailable = live && !!setup?.tripwire;
  const cueInput = (): CueInput => {
    const cs = session.current;
    if (!cs) return {};
    const pic = cs.shapingSide;
    return { tripwireMs: cs.tripwireMs, shapingSide: pic ? (setup?.mirror ? pic : flip(pic)) : undefined };
  };

  /** Defender trigger from the live onset detector: the first confident onset after `sinceMs`. */
  const defenderInput = (sinceMs: number): DefenderInput => {
    const o = session.current?.onset.onsets.find((x) => x.reportMs >= sinceMs);
    if (!o) return {};
    const side = o.pictureSide ? (setup?.mirror ? o.pictureSide : flip(o.pictureSide)) : undefined;
    return { triggerAtMs: o.reportMs, feint: { direction: side, quality: o.quality, confidence: o.confidence } };
  };

  return {
    live,
    defenderInput,
    error,
    framing,
    roomCheck,
    recording: live && s.phase === 'active' && !!block && recordable(block) && !!setup,
    tripwireAvailable,
    cueInput,
    /** Resolves when every clip so far is saved and its presence recorded. */
    flush: () => pending.current,
    clipError,
  };
}
