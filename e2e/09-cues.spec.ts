import { expect, test, type Page } from '@playwright/test';
import { advance, arrowCues, boot, captureSpeech, button, fillForm, home, openFocus, openParent, patchSettings, place, setup, start, startBlockNow, table, scoredBy , holdStop } from './helpers';

type Block = { index: number; drillId?: string; cueLevel?: string; cueLog?: { cueMs?: number; repStartMs: number; value?: string }[] };

async function toFirstWorkBlock(page: Page) {
  await advance(page, 191_000); // countdown + warm-up
  await startBlockNow(page);
  await advance(page, 10_500); // countdown
}

/** Steps the clock until a cue is on screen. */
async function nextCue(page: Page): Promise<string> {
  for (let i = 0; i < 80; i++) {
    await page.clock.runFor(250);
    const word = page.locator('.cue-word');
    const arrow = page.locator('.cue-screen svg');
    if (await word.count()) return (await word.innerText()).trim();
    if (await arrow.count()) return `arrow:${await arrow.first().getAttribute('aria-label')}`;
  }
  throw new Error('no cue appeared');
}

test('arrow cues fill the screen in a cue drill; the cue log is saved with the block', async ({ page }) => {
  await boot(page);
  await setup(page);
  await arrowCues(page);
  await place(page, 'Feinting', 9);
  await start(page, 'Feinting · Stage 3 · Session 9');
  await toFirstWorkBlock(page);
  await expect(page.locator('.practice.cue')).toBeVisible();
  await expect(page.getByText(/^rep 1/)).toBeVisible();
  const first = await nextCue(page);
  expect(['arrow:LEFT', 'arrow:RIGHT']).toContain(first);
  const box = await page.locator('.cue-screen svg').boundingBox();
  expect(box!.height).toBeGreaterThan(768 / 3); // at least a third of the screen height
  // A minute of reps, then end the block.
  await advance(page, 60_000, 250);
  await button(page, 'DONE').click();
  await button(page, /^Next/).click();
  await holdStop(page); // from the next demo view
  await expect(page.getByRole('heading', { name: 'Session saved' })).toBeVisible();
  const [rec] = await table<{ blocks: Block[] }>(page, 'sessionRecords');
  const f5 = rec.blocks.find((b) => b.drillId === 'F5')!;
  expect(f5.cueLevel).toBe('engine-timed');
  expect(f5.cueLog!.length).toBeGreaterThanOrEqual(6);
  for (const e of f5.cueLog!.filter((x) => x.cueMs !== undefined)) {
    expect(e.cueMs! - e.repStartMs).toBeGreaterThanOrEqual(1500);
    expect(e.cueMs! - e.repStartMs).toBeLessThanOrEqual(2600);
  }
  // Parent → Cue drills → Recent cue logs lists them.
  await home(page);
  await openParent(page, /^Cue drills/);
  await button(page, 'Recent cue logs').click();
  await expect(page.locator('.modal')).toContainText('block 2 F5 · engine-timed');
  await expect(page.locator('.modal tr', { hasText: /LEFT|RIGHT/ }).first()).toBeVisible();
});

test('word cues: the SB benchmark runs its 10 reps at the stage cue duration, then asks for the score', async ({ page }) => {
  await boot(page);
  await setup(page);
  await place(page, 'Scanning', 3);
  await start(page, 'Scanning · Stage 1 · Session 3');
  // Skip the two work blocks to reach the benchmark.
  await advance(page, 191_000);
  await button(page, 'Skip block').click(); // S2
  await advance(page, 61_000); // rest
  await button(page, 'Skip block').click(); // S2 again (S3 is now an optional diagnostic)
  await expect(page.getByRole('heading', { name: /Benchmark · Cue-behind decision test/i })).toBeVisible();
  // The test has its cone set-up too (receive box, the same as the drill before it), and the countdown says where the start is.
  // What the screen will show, and what to do for each word.
  const how = page.getByTestId('cue-rules');
  await expect(how.getByTestId('cue-steps')).toContainText('Push the ball forward. Follow it.'); // no wall in this room
  await expect(how.getByTestId('cue-steps')).toContainText('Check your shoulder.');
  await expect(how.locator('.howto-word', { hasText: 'BOTH BLOCKED' })).toContainText('Stop it. Go back.');
  await expect(how.locator('.howto-word', { hasText: 'LEFT FREE' })).toContainText('Touch and turn LEFT.');
  await page.getByText('Cones: same as the last block (tap to see)').click();
  await expect(page.getByTestId('cone-setup')).toContainText('Receive box');
  await startBlockNow(page);
  await expect(page.locator('.practice .sub')).toContainText('Walk to the start. Stand between the cones and the Chromebook, with your back to the screen.');
  // ↺ Instructions goes back to the test's instructions; Start begins it again.
  await button(page, '↺ Instructions').click();
  await expect(page.getByTestId('cue-rules')).toBeVisible();
  await startBlockNow(page);
  await advance(page, 10_500);
  const cue = await nextCue(page);
  expect(['LEFT FREE', 'RIGHT FREE', 'BOTH BLOCKED']).toContain(cue);
  // Shown for the stage's 3 s, then cleared.
  await page.clock.runFor(2_500);
  await expect(page.locator('.cue-word')).toHaveText(cue);
  await page.clock.runFor(800);
  await expect(page.locator('.cue-word')).toHaveCount(0);
  // 10 reps of 9 s end the block by themselves.
  await advance(page, 95_000, 1_000);
  await expect(page.locator('.count', { hasText: 'Correct decisions /10' })).toBeVisible();
  await expect(page.getByText('layout v1 · level 3')).toBeVisible();
});

test('anchor A3 with the cue engine records the engine condition', async ({ page }) => {
  await boot(page);
  await setup(page);
  await openFocus(page);
  await button(page, 'Anchor check · due').click();
  await page.getByRole('checkbox').uncheck();
  await button(page, 'Start').click();
  const levels: string[] = [];
  for (let i = 0; i < 200 && levels.length < 4; i++) {
    const save = page.getByRole('button', { name: 'Confirm', exact: true });
    if (await save.isVisible().catch(() => false)) {
      levels.push(await page.locator('.pill.info').innerText());
      await fillForm(page);
      await save.click();
      await expect(save).toBeHidden();
      continue;
    }
    if ((await page.locator('.practice .drill').count()) && (await page.locator('.practice .drill').textContent())?.trim() === 'Pattern R') {
      for (const _ of [0, 1]) {
        await page.clock.runFor(8_100 + 10_000);
        await page.getByRole('button', { name: 'Finish' }).click();
      }
      continue;
    }
    await page.clock.runFor(10_000);
  }
  expect(levels).toEqual([
    'anchor layout (fixed) · level std',
    'anchor layout (fixed) · level std',
    'anchor layout (fixed) · level engine-timed',
    'anchor layout (fixed) · level engine-timed',
  ]);
});

test('cue engine off: cue drills show the normal practice view (SwitchedOn fallback)', async ({ page }) => {
  await boot(page);
  await setup(page);
  await patchSettings(page, { cueEngine: false });
  await arrowCues(page);
  await place(page, 'Feinting', 9);
  await start(page, 'Feinting · Stage 3 · Session 9');
  await toFirstWorkBlock(page);
  await expect(page.locator('.practice .clock')).toBeVisible();
  await expect(page.locator('.practice.cue')).toHaveCount(0);
});

test('a camera estimate from this block starts the SB card when every rep was judged (D10)', async ({ page }) => {
  await boot(page);
  await setup(page);
  await place(page, 'Scanning', 3);
  await start(page, 'Scanning · Stage 1 · Session 3');
  await advance(page, 191_000);
  await button(page, 'Skip block').click();
  await advance(page, 61_000);
  // (Stand-in for the after-block analysis of this block: all 10 reps judged, 6 correct. Written before the
  // benchmark block opens because a raw database write does not wake the app's live queries.)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open('home-training');
        r.onsuccess = () => {
          const t0 = r.result.transaction('sessionRecords', 'readonly');
          const all = t0.objectStore('sessionRecords').getAll();
          all.onsuccess = () => {
            const rec = (all.result as { id: string; date: string }[]).sort((a, b) => b.date.localeCompare(a.date))[0];
            const tx = r.result.transaction(['clips', 'blockAnalyses', 'repAnalyses'], 'readwrite');
            for (let b = 0; b < 12; b++) {
              const id = `clip-${b}`;
              tx.objectStore('clips').put({ id, sessionRecordId: rec.id, blockIndex: b, attempt: 1, date: new Date().toISOString(), blob: new Blob(['x']), mime: 'video/webm', blockLabel: 'SB', durationS: 90, startActiveMs: 0 });
              tx.objectStore('blockAnalyses').put({ id, clipId: id, data: { reps: 10, validReps: 10, accuracyByCue: {}, flaggedRepIndexes: [], enoughReps: true, poseUsed: false, analysedFps: 15, analysisMs: 10 } });
              for (let i = 0; i < 10; i++) tx.objectStore('repAnalyses').put({ id: `${id}-${i}`, clipId: id, repIndex: i, data: { repIndex: i, zoneEvents: [], confidence: 0.9, flags: [], status: 'ok', decisionCorrect: i < 6 } });
            }
            tx.oncomplete = () => resolve();
          };
        };
      }),
  );
  await button(page, 'Skip block').click();
  await startBlockNow(page);
  await advance(page, 10_500);
  await advance(page, 95_000, 1_000);
  await expect(page.locator('.count', { hasText: 'Correct decisions /10' })).toBeVisible();
  await expect(page.getByText(/Camera estimate from this block \(all 10 reps judged\)/)).toBeVisible();
  await expect(page.locator('.count[data-blank]')).toHaveCount(0);
  await scoredBy(page);
  await button(page, 'Confirm').click();
  const res = await table<{ benchmarkId: string; values: { correct: number }; prefilledFrom?: string }>(page, 'benchmarkResults');
  expect(res.find((x) => x.benchmarkId === 'SB')).toMatchObject({ values: { correct: 6 }, prefilledFrom: 'camera' });
});

test('cones, then instructions with the game purpose, then "Try it": 3 slow reps, a check card, then the real drill', async ({ page }) => {
  await boot(page);
  await setup(page);
  await place(page, 'Scanning', 3);
  await start(page, 'Scanning · Stage 1 · Session 3');
  await advance(page, 191_000); // warm-up, then the first cue drill's demo view
  await button(page, '✓ Cones are out: show the instructions').click();
  await expect(page.getByTestId('cue-why')).toContainText('Look before the ball comes.');
  await button(page, 'Try it first: 3 slow reps, checked by the camera').click();
  await expect(page.locator('.practice .drill, .cue-header').first()).toBeVisible();
  await advance(page, 10_500 + 3 * 15_000 + 2_000);
  const card = page.getByTestId('practice-card');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Recording is off in the app'); // camera off in this test
  await expect(card.getByRole('button', { name: 'Turn recording on, then Try again' })).toBeVisible();
  await expect(card.locator('tbody tr')).toHaveCount(3);
  // Back to the instructions skips the cones step (they are out), then the real drill.
  await button(card, 'Back to the instructions').click();
  await expect(page.getByTestId('cones-step')).toHaveCount(0);
  await expect(page.getByTestId('try-it')).toBeVisible();
  await startBlockNow(page);
  await expect(page.getByText('Try it')).toHaveCount(0);
  const recs = await table<{ blocks: { attempt: number; practice?: boolean }[] }>(page, 'sessionRecords');
  expect(recs.length === 0 || recs[0].blocks.every((b) => b.attempt > 0 || b.practice)).toBe(true);
  // The end-of-drill card lists the practice apart, never as "attempt 0" (Brief R15).
  await advance(page, 10_500 + 5 * 60_000);
  await button(page, 'DONE').click();
  await expect(page.locator('.endcard')).toBeVisible();
  await expect(page.locator('.endcard')).toContainText('attempt 1 today');
  await expect(page.locator('.endcard')).not.toContainText('attempt 0');
  await expect(page.getByTestId('practice-rounds')).toContainText('Practice (not scored): 1 round');
});

test('with a wall: the wall version of the steps (kick at the wall, check your shoulder, receive the bounce)', async ({ page }) => {
  await boot(page);
  await setup(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open('home-training');
        r.onsuccess = () => {
          const tx = r.result.transaction('roomProfiles', 'readwrite');
          const st = tx.objectStore('roomProfiles');
          const g = st.get('room-1');
          g.onsuccess = () => st.put({ ...g.result, wallUsable: true });
          tx.oncomplete = () => resolve();
        };
      }),
  );
  await page.reload();
  await patchSettings(page, { sound: { tones: true, speech: true, endOfSessionLine: true, volume: 0.9, voiceRate: 0.95, wallMic: false } });
  await page.reload();
  await place(page, 'Scanning', 3);
  await start(page, 'Scanning · Stage 1 · Session 3');
  await advance(page, 191_000);
  await button(page, '✓ Cones are out: show the instructions').click();
  const steps = page.getByTestId('cue-steps');
  await expect(steps).toContainText('Face the back wall. Screen behind you.');
  await expect(steps).toContainText('Kick the ball at the wall.');
  await expect(steps).toContainText('Ball comes back: touch the way the word says.');
});

test('the voice talks through the instructions; skip it, or mark the drill as known so it is not read next time', async ({ page }) => {
  const said = await captureSpeech(page);
  await boot(page);
  await setup(page);
  await place(page, 'Scanning', 3);
  await start(page, 'Scanning · Stage 1 · Session 3');
  await advance(page, 191_000);
  await button(page, '✓ Cones are out: show the instructions').click();
  await expect.poll(async () => (await said()).join(' | ')).toContain('Why: Look before the ball comes.');
  const text = (await said()).find((t) => t.startsWith('Cue-behind self-receive.'))!;
  expect(text).toContain('1. Back to the screen. Ball at your feet.');
  expect(text).toContain('LEFT FREE: Touch and turn LEFT.');
  const talk = page.getByTestId('talk-controls');
  const knows = talk.getByLabel("The player knows this one: don't read it out next time");
  await knows.click();
  await expect(knows).toBeChecked();
  await expect.poll(async () => (await table<{ talkThroughSkip?: string[] }>(page, 'settings'))[0].talkThroughSkip ?? []).toContain('S2');
  await expect(button(talk, '🔊 Read it out')).toBeVisible();
});
