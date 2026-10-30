import { expect, test, type Page } from '@playwright/test';
import { advance, boot, button, captureSpeech, demoShowing, home, place, runToEnd, setup, start, startBlockNow, startCard, table , holdStop } from './helpers';

type Rec = { areaId: string; sessionNumber: number; status: string; reasons: string[]; trial: boolean; blocks: { index: number; attempt: number; note?: string; doneEarly: boolean; skipped: boolean }[] };

async function ready(page: Page) {
  await boot(page);
  await setup(page);
  await place(page, 'Dribbling', 1);
}

/** Warm-up: 10 s countdown + 3 min. Then block 2's demo view. */
async function toBlock2Demo(page: Page) {
  await advance(page, 10_000 + 180_000 + 1_000);
  await expect(demoShowing(page)).toBeVisible();
}

test('a 20-minute session runs to the end without a tap, counts, and unlocks the next', async ({ page }) => {
  const said = await captureSpeech(page);
  await ready(page);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  // Countdown, then the warm-up practice view.
  await expect(page.locator('.practice .drill')).toHaveText('Warm-up');
  await advance(page, 11_000);
  await expect(page.locator('.practice .clock')).toHaveText(/^2:5\d$/);
  await expect(button(page, 'PAUSE')).toBeVisible();
  await expect(button(page, 'Skip warm-up')).toBeVisible(); // the warm-up can be skipped; no DONE on timed blocks
  await runToEnd(page);
  await expect(page.getByRole('heading', { name: 'Session saved' })).toBeVisible();
  const card = page.locator('.card', { hasText: 'Dribbling · Session 1' });
  await expect(card).toContainText('completed');
  await expect(card).toContainText('Dribbling Session 1 complete: all 4 blocks, 20 minutes.');
  await expect(card).toContainText('All planned blocks completed.');
  await expect(card).toContainText('Dribbling Session 2 is unlocked.');
  const text = (await said()).join(' | ');
  expect(text).toContain('Warm-up in 10 seconds.');
  expect(text).toContain('Jog on the spot, ankle circles');
  expect(text).toContain('Half way.');
  expect(text).toContain('Thirty seconds.');
  expect(text).toMatch(/Rest\. Next: Slalom close control\./);
  expect(text).toContain('Dribbling Session 1 complete'); // end-of-session line
  expect(text).not.toMatch(/great job|streak/i);

  await button(page, 'Done').click();
  // First completed session in an area: a milestone card, shown once.
  await expect(page.getByText(/First completed Dribbling session/)).toBeVisible();
  await button(page, 'OK').click();
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 2')).toBeVisible();
  await expect(page.getByText('1 of 3 planned done')).toBeVisible();
  const recs = await table<Rec>(page, 'sessionRecords');
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ status: 'completed', trial: false, sessionNumber: 1 });
});

test('skipping a core block gives a partial session that stays next', async ({ page }) => {
  await ready(page);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await toBlock2Demo(page);
  await button(page, 'Skip block').click();
  await runToEnd(page);
  const card = page.locator('.card', { hasText: 'Dribbling · Session 1' });
  await expect(card).toContainText('partial');
  await expect(card).toContainText('Partial session saved. Session 1 stays as your next session.');
  await expect(card).toContainText('Reason: block 2 skipped.');
  await home(page);
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 1')).toBeVisible();
  await expect(page.getByText('0 of 3 planned done')).toBeVisible();
});

test('a 6-minute pause gives partial; PAUSE stops the clock', async ({ page }) => {
  await ready(page);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await advance(page, 40_000);
  await button(page, 'PAUSE').click();
  await expect(page.locator('.practice .clock')).toHaveText('PAUSED');
  await advance(page, 6 * 60_000);
  await button(page, 'RESUME').click();
  await expect(page.locator('.practice .clock')).toHaveText(/^2:2\d$/); // the warm-up clock did not run while paused
  await runToEnd(page);
  await expect(page.locator('.card', { hasText: 'Dribbling · Session 1' })).toContainText('Reason: paused 6 minutes.');
});

test('STOP ends the session as stopped, not counted', async ({ page }) => {
  const said = await captureSpeech(page);
  await ready(page);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await advance(page, 30_000);
  // A short tap does nothing: STOP is press-and-hold (audit task 13).
  await button(page, 'STOP').click();
  await page.clock.runFor(2_000);
  await expect(page.getByRole('heading', { name: 'Session saved' })).toHaveCount(0);
  await holdStop(page);
  await expect(page.getByRole('heading', { name: 'Session saved' })).toBeVisible();
  const card = page.locator('.card', { hasText: 'Dribbling · Session 1' });
  await expect(card).toContainText('stopped — not counted');
  await expect(card).toContainText('Stopped. If anything hurts, talk to a parent or a qualified professional before training again.');
  expect(await said()).toContain('Stopped.');
  await home(page);
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 1')).toBeVisible();
});

test('demo view starts by itself; Start block, DONE after 80%, Repeat and notes on the end-of-drill card', async ({ page }) => {
  await ready(page);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await toBlock2Demo(page);
  // Demo view content.
  await expect(page.getByRole('heading', { name: 'SLALOM CLOSE CONTROL' })).toBeVisible();
  await button(page, '✓ Cones are out: show the instructions').click();
  await expect(page.getByText(/Set-up:.*L1 Slalom — 5 cones 1 m apart/)).toBeVisible();
  // The slalom's approved YouTube demonstration plays when YouTube can be reached (CI); otherwise the fallback shows.
  await expect(
    page
      .getByText('Own demonstration not recorded yet.')
      .or(page.getByText(/No demonstration|could not be reached/))
      .or(page.locator('.video iframe[src*="youtube"]'))
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/Starts by itself in \d+ s/)).toBeVisible();
  await startBlockNow(page);
  await expect(page.locator('.practice .drill')).toHaveText('Slalom close control');
  await advance(page, 10_000 + 0.85 * 360_000);
  await button(page, 'DONE').click();
  // End-of-drill card.
  await expect(page.locator('.endcard .title')).toHaveText('Slalom close control');
  await expect(page.locator('.endcard')).toContainText('attempt 1 today');
  await expect(page.locator('.endcard .now')).toContainText(/Slalom close control: 5:0\d of 6:00\./);
  await button(page, 'Add a note').click();
  await page.getByPlaceholder('Note on this block').fill('ball ran away on the left');
  await button(page, 'Save note').click();
  await expect(page.locator('.endcard')).toContainText('Note: “ball ran away on the left”');
  await button(page, 'Repeat').click();
  await expect(page.locator('.practice .drill')).toHaveText('Slalom close control');
  await advance(page, 10_000 + 360_000 + 500);
  await expect(page.locator('.endcard')).toContainText('attempt 2 today');
  await expect(page.locator('.endcard')).toContainText(/Earlier today: attempt 1: 5:0\d/);
  await expect(button(page, /^Next \(\d+\)$/)).toBeVisible(); // Next counts down on its own
  await runToEnd(page);
  await expect(page.locator('.card', { hasText: 'Dribbling · Session 1' })).toContainText('completed');
  const [rec] = await table<Rec>(page, 'sessionRecords');
  const block2 = rec.blocks.filter((b) => b.index === 1);
  expect(block2.map((b) => b.attempt)).toEqual([1, 2]);
  expect(block2[0]).toMatchObject({ doneEarly: true, note: 'ball ran away on the left' });
});

test("the end-of-drill card shows last time's block from an earlier session", async ({ page }) => {
  await ready(page);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await runToEnd(page);
  await home(page);
  await start(page, 'Dribbling · Stage 1 · Session 2');
  await toBlock2Demo(page);
  await advance(page, 85_000 + 10_000 + 360_000); // the slalom's cones step (60 s) and its instructions (20 s) first
  await expect(page.locator('.endcard')).toContainText(/Last time \(Nov 3\): 3:00 of 3:00/);
});

test("player's choice block: pick the drill at the demo view", async ({ page }) => {
  await ready(page);
  await place(page, 'Dribbling', 16);
  await start(page, 'Dribbling · Stage 4 · Session 16');
  await toBlock2Demo(page).catch(() => undefined);
  await expect(page.getByText('Pick the drill for this block:')).toBeVisible();
  await button(page, 'D2 · Push-and-go').click();
  await expect(page.locator('.practice .drill')).toHaveText('Push-and-go');
});

test('the warm-up can be skipped with one tap; the session is then partial and stays next', async ({ page }) => {
  await ready(page);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await expect(page.locator('.practice .drill')).toHaveText('Warm-up');
  await button(page, 'Skip warm-up').click(); // from the countdown
  await expect(demoShowing(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SLALOM CLOSE CONTROL' })).toBeVisible();
  await runToEnd(page);
  const card = page.locator('.card', { hasText: 'Dribbling · Session 1' });
  await expect(card).toContainText('partial');
  const [rec] = await table<Rec>(page, 'sessionRecords');
  expect(rec.status).toBe('partial');
  expect(rec.reasons).toContain('warm-up not finished');
  expect(rec.blocks[0]).toMatchObject({ skipped: true });
});

test('a failed end-of-session save shows Try again, and Try again reaches the summary (audit task 8)', async ({ page }) => {
  await boot(page);
  await setup(page);
  await start(page, /Scanning · Baseline/);
  await page.clock.runFor(5_000);
  await page.evaluate(() => ((window as unknown as { __failNextFinalSave: boolean }).__failNextFinalSave = true));
  await holdStop(page);
  await page.clock.resume();
  const card = page.getByTestId('save-error');
  await expect(card).toContainText('This session could not be saved yet (test: save failed). Tap Try again.');
  await button(card, 'Try again').click();
  await expect(page.getByRole('heading', { name: /Session saved/ })).toBeVisible();
});

test('a hidden page pauses the session; it waits on PAUSED for a tap (audit task 11)', async ({ page }) => {
  await boot(page);
  await setup(page);
  await start(page, /Scanning · Baseline/);
  await page.clock.runFor(12_000); // into the warm-up
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(1_000);
  await expect(page.getByText('PAUSED').first()).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(5_000);
  await expect(page.getByText('PAUSED').first()).toBeVisible(); // no automatic resume
});
