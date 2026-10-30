import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import type { CameraSetup, Clip } from '../db/types';
import { loadProgramme } from '../test/fixtures';
import { analyseClip, setWorkerFactory } from './run';

// Audit 2026-10-29 task 7: a worker that crashes, or a model that fails to load, never blocks later analyses.

class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  constructor(private mode: 'crash' | 'error') {}
  postMessage(msg: { type: string }) {
    if (msg.type !== 'init') return;
    setTimeout(() => {
      if (this.mode === 'crash') this.onerror?.({ message: 'worker crashed', preventDefault: () => undefined } as unknown as ErrorEvent);
      else this.onmessage?.({ data: { type: 'error', message: 'model failed' } } as MessageEvent);
    }, 5);
  }
  terminate() {}
}

const setup = { drillFamily: 'L2', zones: [], mirror: false } as unknown as CameraSetup;
const clip = (id: string) => ({ id, blob: new Blob(), blockLabel: id, sessionRecordId: 'r', blockIndex: 0, attempt: 1, durationS: 10, startActiveMs: 0 }) as unknown as Clip;
const log = [{ rep: 0, repStartMs: 0, trigger: 'timed' as const, cueMs: 100, plannedDelayMs: 0, value: 'LEFT' }];

// The runner builds the WebAssembly path from the page's address.
(globalThis as unknown as { document: { baseURI: string } }).document = { baseURI: 'http://localhost/' };

describe('analysis queue', () => {
  it('a crashed worker and a failed model are logged, and the queue carries on', async () => {
    const modes: ('crash' | 'error')[] = ['crash', 'error'];
    setWorkerFactory(() => new FakeWorker(modes.shift() ?? 'error') as unknown as Worker);
    const p = loadProgramme();
    void analyseClip(p, clip('first'), { kind: 'work', minutes: 1, mode: 'reps' }, setup, log);
    await analyseClip(p, clip('second'), { kind: 'work', minutes: 1, mode: 'reps' }, setup, log);
    const failed = (await db.history.toArray()).filter((h) => h.action === 'analysis failed');
    expect(failed.map((h) => h.detail)).toEqual(['first: worker crashed', 'second: model failed']);
  });
});
