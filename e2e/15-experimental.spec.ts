import { expect, test } from '@playwright/test';
import { advance, boot, button, openFocus, openParent, patchSettings, runToEnd, setup, startBlockNow, table, scoredBy } from './helpers';

// Experimental features, each off by default: the digit diagnostic by voice and the ball detector
// model (network only). Cone detection is in 16-cone-detection.spec.ts.

const FLAGS = { defender3d: true, liveOnsetDetector: false, speechDiagnostic: false, notifications: false, ballTracking: false, learning: false, coneDetection: false, neuralBallDetector: false };

test('digit diagnostic by voice: off by default; when on, what is heard becomes the starting estimate on the card', async ({ page }) => {
  test.setTimeout(240_000);
  // A stand-in for Chrome's speech service: the test "says" a number by calling __say.
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((ev: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      start() {
        (window as unknown as { __rec: FakeRecognition }).__rec = this;
      }
      stop() {}
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
    (window as unknown as { __say: (t: string) => void }).__say = (t: string) => {
      const r = (window as unknown as { __rec?: FakeRecognition }).__rec;
      r?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
    };
  });
  await boot(page);
  await setup(page);
  await patchSettings(page, { flags: { ...FLAGS, speechDiagnostic: true } });
  await page.reload();
  await openFocus(page);
  await button(page, 'Scanning diagnostic (optional)').click();
  await page.getByRole('checkbox').uncheck();
  await button(page, 'Start').click();
  await advance(page, 10_000 + 180_000 + 1_000); // countdown and warm-up
  await startBlockNow(page);
  await advance(page, 10_500);
  // Call out each number as it appears; get two wrong on purpose.
  let said = 0;
  let last = '';
  for (let i = 0; i < 600 && said < 10; i++) {
    await page.clock.runFor(250);
    const n = page.locator('.cue-number');
    const t = (await n.count()) ? (await n.innerText()).trim() : '';
    if (t && t !== last) {
      last = t;
      said++;
      const word = said <= 2 ? String(((Number(t) % 9) + 1)) : ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][Number(t)];
      await page.evaluate((w) => (window as unknown as { __say: (t: string) => void }).__say(w), word);
    } else if (!t) last = '';
  }
  expect(said).toBeGreaterThanOrEqual(8);
  await runToEnd(page, {
    onForm: async (p) => {
      await expect(p.getByText(/Speech \(experimental\): heard a number on \d+ of the first 10 reps, \d+ right/)).toBeVisible();
      // The numbers count starts from the estimate (current block only); directions stay blank.
      await expect(p.locator('.count[data-blank]')).toHaveCount(1);
      await p.getByRole('button', { name: 'Directions right /10 9', exact: true }).click();
      await scoredBy(p);
      await button(p, 'Confirm').click();
    },
  });
  const obs = await table<{ metricId: string; value: number; detectorVersion?: string }>(page, 'metricObservations');
  const d = obs.find((o) => o.metricId === 'digitCorrect')!;
  expect(d.detectorVersion).toBe('speech-estimate-confirmed');
  expect(d.value).toBe(said - 2);
});

test('ball detector model speed test (needs network for the model)', async ({ page }) => {
  test.skip(!process.env.E2E_NETWORK, 'set E2E_NETWORK=1 to download the detector model');
  test.setTimeout(240_000);
  await boot(page, { clock: false });
  await setup(page);
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const ctx = c.getContext('2d')!;
    const s = c.captureStream(30);
    const rec = new MediaRecorder(s, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    for (let f = 0; f < 60; f++) {
      ctx.fillStyle = '#3c6e46';
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(80 + f * 2, 120, 18, 0, Math.PI * 2);
      ctx.fill();
      await new Promise((r) => setTimeout(r, 33));
    }
    await new Promise((r) => {
      rec.onstop = r;
      rec.stop();
    });
    const blob = new Blob(chunks, { type: 'video/webm' });
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('home-training');
      req.onsuccess = () => {
        const tx = req.result.transaction('clips', 'readwrite');
        tx.objectStore('clips').put({ id: 'ballclip', blob, mime: 'video/webm', blockLabel: 'C2', sessionRecordId: 'r', blockIndex: 1, attempt: 1, date: new Date().toISOString(), durationS: 2, startActiveMs: 0 });
        tx.oncomplete = () => resolve();
      };
    });
  });
  await openParent(page, /^Balls/);
  await page.getByText('Advanced (optional): detector model speed test').click();
  await page.locator('select').selectOption('ballclip');
  await button(page, 'Run the detector test').click();
  await expect(page.locator('.note-box')).toContainText(/fps on the (GPU|CPU) delegate/, { timeout: 200_000 });
  const [s] = await table<{ capabilities: { ballDetectorFps: number } }>(page, 'settings');
  expect(s.capabilities.ballDetectorFps).toBeGreaterThan(0);
});

test('ball detector speed test from a clip recorded on the spot: open the camera, record, stop, result', async ({ page }) => {
  test.skip(!process.env.E2E_NETWORK, 'set E2E_NETWORK=1 to download the detector model');
  test.setTimeout(300_000);
  await boot(page, { clock: false });
  await setup(page);
  await openParent(page, /^Balls/);
  await page.getByText('Advanced (optional): detector model speed test').click();
  await button(page, 'Open the camera').click();
  await expect(button(page, '● Record')).toBeVisible({ timeout: 15_000 });
  await button(page, '● Record').click();
  await page.waitForTimeout(3000);
  await button(page, /■ Stop/).click();
  await expect(page.locator('.note-box')).toContainText(/fps on the (GPU|CPU) delegate/, { timeout: 200_000 });
});
