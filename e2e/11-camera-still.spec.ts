import { expect, test } from '@playwright/test';
import { cameraSetup } from './camera-helpers';
import { stillVideo } from './fake-video';
import { advance, boot, button, closeParent, openParent, parentMenu, place, runToEnd, setup, start, startBlockNow, table } from './helpers';

const baseArgs = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

type Block = { index: number; drillId?: string; presenceFrac?: number; clipId?: string; cueLog?: { trigger: string; tripwireMs?: number; cueMs?: number; missedTripwire?: boolean }[] };

// Fake webcam: a still picture, i.e. nobody in the lane.
test.use({ launchOptions: { args: [...baseArgs, `--use-file-for-fake-video-capture=${stillVideo()}`] } });

  test("a work block the camera's activity check cannot confirm is reported as a camera check: the session is partial (Brief R03)", async ({ page }) => {
    test.setTimeout(300_000);
    await boot(page);
    await setup(page);
    await cameraSetup(page, 'L1');
    // Make the first slalom block 1 minute (and the last one longer) so the recorded block is short.
    await openParent(page, /^Session blocks/);
    await page.locator('select').first().selectOption('dribbling-1');
    const minutes = page.locator('table.data input[type=number]');
    await minutes.nth(1).fill('1');
    await minutes.nth(4).fill('8');
    await expect(page.getByText('Total 20 of 20 min')).toBeVisible();
    await button(page, 'Save').click();
    await parentMenu(page);
    await closeParent(page);
    await place(page, 'Dribbling', 1);
    await start(page, 'Dribbling · Stage 1 · Session 1');
    await advance(page, 191_000);
    await button(page, '✓ Cones are out: show the instructions').click();
    await page.clock.runFor(2_000);
    await expect(page.getByText('Camera set up as before.')).toBeVisible();
    await startBlockNow(page);
    await page.clock.resume();
    await expect(page.locator('.endcard')).toBeVisible({ timeout: 100_000 }); // 10 s countdown + 1 minute, real time
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    await runToEnd(page);
    const card = page.locator('.card', { hasText: 'Dribbling · Session 1' });
    await expect(card).toContainText('partial');
    await expect(card).toContainText(/Reason: block 2: camera activity check could not confirm it(, block \d: camera activity check could not confirm it)*./); // every work block in an empty lane
    await expect(card).toContainText(/Practice saved: \d+ minutes./);
    const [rec] = await table<{ blocks: Block[] }>(page, 'sessionRecords');
    expect(rec.blocks.find((b) => b.index === 1)!.presenceFrac).toBeLessThan(0.7);
    // The player says they did it (owner decision 2026-10-30): the session completes, on the player's word.
    await expect(card.getByTestId('activity-confirm')).toContainText('The camera could not confirm block 2');
    await button(card, 'I did it').click();
    await expect(card.getByTestId('activity-confirmed')).toContainText("done, on the player's word");
    const [after] = await table<{ status: string; blocks: (Block & { activityConfirmedBy?: string })[] }>(page, 'sessionRecords');
    expect(after.status).toBe('completed');
    expect(after.blocks.find((b) => b.index === 1)!.activityConfirmedBy).toBe('player');
  });
