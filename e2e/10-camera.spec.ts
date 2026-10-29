import { expect, test } from '@playwright/test';
import { cameraSetup } from './camera-helpers';
import { movingVideo } from './fake-video';
import { advance, arrowCues, boot, button, home, openParent, place, setup, start, startBlockNow, table } from './helpers';

// Fake webcam: a moving picture with a tripwire flash every 4 s.
const baseArgs = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  // Behind a proxy (E2E_PROXY), the pose models download through it; the app itself stays local.
  ...(process.env.E2E_PROXY ? [`--proxy-server=${process.env.E2E_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1', '--ignore-certificate-errors'] : []),
];

type Block = { index: number; drillId?: string; presenceFrac?: number; clipId?: string; cueLog?: { trigger: string; tripwireMs?: number; cueMs?: number; missedTripwire?: boolean }[] };

test.use({ launchOptions: { args: [...baseArgs, `--use-file-for-fake-video-capture=${movingVideo()}`] } });

  test('camera set-up per drill family; a redo retires the old set-up', async ({ page }) => {
    await boot(page, { clock: false });
    await setup(page);
    await cameraSetup(page, 'L2');
    await cameraSetup(page, 'L2', { enable: false });
    const setups = await table<{ drillFamily: string; retiredAt?: string; zones: unknown[]; homography?: number[]; mirror: boolean }>(page, 'cameraSetups');
    expect(setups).toHaveLength(2);
    expect(setups.filter((s) => !s.retiredAt)).toHaveLength(1);
    expect(setups[1]).toMatchObject({ drillFamily: 'L2', mirror: true });
    expect(setups[1].zones).toHaveLength(4);
    expect(setups[1].homography).toHaveLength(9);
    const [s] = await table<{ camera: { enabled: boolean } }>(page, 'settings');
    expect(s.camera.enabled).toBe(true);
  });

  test('a cue block records itself: framing light, tripwire cues, clip, analysis, scorecard, clip player', async ({ page }) => {
    test.setTimeout(300_000);
    await boot(page);
    await setup(page);
    await cameraSetup(page, 'L2');
    await arrowCues(page);
    await place(page, 'Feinting', 9);
    await start(page, 'Feinting · Stage 3 · Session 9');
    await advance(page, 191_000);
    await button(page, '✓ Cones are out: show the instructions').click();
    // The test video has a bar that flashes for half a second every 4 s; the check runs every second.
    for (let i = 0; i < 15 && !(await page.getByText('Camera set up as before.').count()); i++) await page.clock.runFor(1_000);
    await expect(page.getByText('Camera set up as before.')).toBeVisible();
    await startBlockNow(page);
    await page.clock.resume(); // recording and the tripwire run in real time
    await expect(page.locator('.practice.cue')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.overlay-top')).toContainText('●'); // recording dot
    await page.waitForTimeout(30_000);
    await button(page, 'DONE').click();
    await expect(page.locator('.endcard')).toContainText(/Recorded\. The camera scorecard appears when the analysis finishes\.|●|○/);
    await expect(page.locator('.endcard .repstrip')).toBeVisible({ timeout: 90_000 });
    await button(page, 'Repeat').click(); // stays in the session; then stop
    await button(page, 'STOP').click();
    await expect(page.getByRole('heading', { name: 'Session saved' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Camera scorecard' }).first()).toBeVisible({ timeout: 30_000 });

    const [rec] = await table<{ blocks: Block[] }>(page, 'sessionRecords');
    const f5 = rec.blocks.find((b) => b.drillId === 'F5' && b.clipId)!;
    expect(f5.cueLog!.length).toBeGreaterThanOrEqual(2);
    expect(f5.cueLog!.every((e) => e.trigger === 'tripwire')).toBe(true);
    const cued = f5.cueLog!.filter((e) => e.cueMs !== undefined);
    expect(cued.length).toBeGreaterThanOrEqual(1);
    for (const e of cued) {
      expect(e.cueMs!).toBeGreaterThanOrEqual(e.tripwireMs!); // never before the tripwire
      expect(e.cueMs! - e.tripwireMs!).toBeLessThanOrEqual(450);
    }
    const clips = await table<{ id: string; blockLabel: string; mime: string }>(page, 'clips');
    expect(clips.some((c) => c.blockLabel === 'F5' && c.mime.startsWith('video/webm'))).toBe(true);
    expect((await table(page, 'blockAnalyses')).length).toBeGreaterThanOrEqual(1);

    // Parent → Clips: replay controls, key frames, keep, save, delete.
    await home(page);
    await openParent(page, /^Clips/);
    await expect(page.getByText(/clips, \d+ MB/)).toBeVisible();
    await page.locator('li', { hasText: 'F5 · attempt 1' }).getByRole('button', { name: 'Open' }).click();
    const video = page.locator('video');
    await expect(video).toBeVisible();
    await button(page, '0.25×').click();
    expect(await video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(0.25);
    await button(page, 'frame ▶').click();
    await button(page, 'frame ▶').click();
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2 / 30, 2);
    await expect(page.getByRole('heading', { name: 'Key frames (cue times)' })).toBeVisible();
    await page.getByRole('heading', { name: 'Key frames (cue times)' }).locator('..').getByRole('button').first().click();
    await expect(page.getByRole('heading', { name: 'Camera scorecard' })).toBeVisible();
    await page.getByLabel('Keep beyond the retention period').click();
    await expect(page.getByLabel('Keep beyond the retention period')).toBeChecked();
    const [dl] = await Promise.all([page.waitForEvent('download'), button(page, 'Save to Downloads').click()]);
    expect(dl.suggestedFilename()).toMatch(/^clip-2026-11-03-F5\.webm$/);
    await button(page, 'Back to clips').click();
    await expect(page.locator('li', { hasText: 'F5 · attempt 1' })).toContainText('kept');
    const before = await page.locator('ul.clean li').count();
    await page.locator('li', { hasText: 'F5 · attempt 1' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('ul.clean li')).toHaveCount(before - 1);
  });

  test('framing check turns red with a fix when the picture does not match the reference', async ({ page }) => {
    await boot(page);
    await setup(page);
    await cameraSetup(page, 'L2');
    // Replace the reference photo with an unrelated picture (as if the camera had been moved a lot).
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      const ctx = c.getContext('2d')!;
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = i % 2 ? '#eee' : '#222';
        ctx.fillRect((i * 37) % 320, (i * 53) % 180, 60, 30);
      }
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg'));
      await new Promise<void>((resolve) => {
        const req = indexedDB.open('home-training');
        req.onsuccess = () => {
          const tx = req.result.transaction('cameraSetups', 'readwrite');
          const st = tx.objectStore('cameraSetups');
          st.getAll().onsuccess = (e) => {
            for (const s of (e.target as IDBRequest).result) st.put({ ...s, referenceFrame: blob });
          };
          tx.oncomplete = () => resolve();
        };
      });
    });
    await page.reload();
    await place(page, 'Feinting', 9);
    await start(page, 'Feinting · Stage 3 · Session 9');
    await advance(page, 191_000);
    await button(page, '✓ Cones are out: show the instructions').click();
    await page.clock.runFor(2_000);
    await expect(page.getByText(/^Camera (has moved|picture does not match)/)).toBeVisible();
  });

  test('clips older than the retention period are deleted at start unless kept', async ({ page }) => {
    await boot(page, { clock: false });
    await setup(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const req = indexedDB.open('home-training');
          req.onsuccess = () => {
            const tx = req.result.transaction('clips', 'readwrite');
            const st = tx.objectStore('clips');
            const base = { blob: new Blob(['x']), mime: 'video/webm', blockLabel: 'F5', sessionRecordId: 'r', blockIndex: 1, attempt: 1, durationS: 1, startActiveMs: 0 };
            st.put({ ...base, id: 'old', date: '2020-01-01T00:00:00.000Z' });
            st.put({ ...base, id: 'kept', date: '2020-01-01T00:00:00.000Z', keep: true });
            st.put({ ...base, id: 'new', date: new Date().toISOString() });
            tx.oncomplete = () => resolve();
          };
        }),
    );
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const ids = (await table<{ id: string }>(page, 'clips')).map((c) => c.id).sort();
    expect(ids).toEqual(['kept', 'new']);
  });

  test('pose speed test applies the frame-rate policy (needs network for the models)', async ({ page }) => {
    test.skip(!process.env.E2E_NETWORK, 'set E2E_NETWORK=1 to download the pose models');
    test.setTimeout(300_000);
    await boot(page, { clock: false });
    await setup(page);
    await page.evaluate(async () => {
      // A clip to test on: 3 s of the fake webcam.
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      const rec = new MediaRecorder(s, { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start();
      await new Promise((r) => setTimeout(r, 3000));
      await new Promise((r) => {
        rec.onstop = r;
        rec.stop();
      });
      s.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: 'video/webm' });
      await new Promise<void>((resolve) => {
        const req = indexedDB.open('home-training');
        req.onsuccess = () => {
          const tx = req.result.transaction('clips', 'readwrite');
          tx.objectStore('clips').put({ id: 'bench', blob, mime: 'video/webm', blockLabel: 'F5', sessionRecordId: 'r', blockIndex: 1, attempt: 1, date: new Date().toISOString(), durationS: 3, startActiveMs: 0 });
          tx.oncomplete = () => resolve();
        };
      });
    });
    await openParent(page, /^Pose speed test/);
    await page.locator('select').selectOption('bench');
    await button(page, 'Run the test').click();
    await expect(page.locator('.note-box')).toContainText(/analyse at|wait for v3/, { timeout: 240_000 });
    const [s] = await table<{ camera: { poseTest?: { liteFps: number; fullFps: number } } }>(page, 'settings');
    expect(s.camera.poseTest!.liteFps).toBeGreaterThan(0);
    expect(s.camera.poseTest!.fullFps).toBeGreaterThan(0);
  });
