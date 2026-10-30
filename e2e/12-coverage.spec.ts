import { expect, test } from '@playwright/test';
import { advance, boot, button, home, openFocus, openParent, parentMenu, patchSettings, place, runToEnd, setup, start, startBlockNow, startCard } from './helpers';

const TILES: [RegExp, string | RegExp][] = [
  [/^Coach notes/, 'New note'],
  [/^Adjust drills/, 'New drill'],
  [/^Session blocks/, 'Session blocks'],
  [/^Cue drills/, /Cue drills run full screen/],
  [/^Advancement/, 'Decisions'],
  [/^Priorities/, /Priority skills show as a tag/],
  [/^Placement/, 'Not placed'],
  [/^Trials/, 'Trial period'],
  [/^Demonstrations/, /Own clips: 15–30 s/],
  [/^Export for the coach/, 'Copy text'],
  [/^History/, 'Content overrides'],
  [/^Camera set-up/, /Camera on: record each drill block/],
  [/^Clips/, /0 clips, 0 MB/],
  [/^Pose speed test/, 'Current setting'],
  [/^Room/, 'Layout versions'],
  [/^Settings/, 'Sound'],
  [/^Backup/, 'Export backup'],
  [/^Content/, /loaded and valid/],
];

test('every parent-mode screen opens', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, { clock: false });
  await setup(page);
  await openParent(page);
  for (const [tile, marker] of TILES) {
    await button(page, tile).click();
    await expect(page.getByText(marker).first()).toBeVisible();
    await parentMenu(page);
  }
  expect(errors).toEqual([]);
});

test('home screen (D14): start my session at 20/30/45/60, goals for today, choose a focus with the other areas', async ({ page }) => {
  await boot(page);
  await setup(page, { focus: false });
  for (const [a, n] of [['Scanning', 1], ['Feinting', 5], ['Dribbling', 5], ['Ball control', 3]] as const) await place(page, a, n);
  await expect(button(page, 'Start my session')).toBeVisible();
  await expect(page.locator('.card.row', { hasText: 'Start' })).toHaveCount(1);
  await expect(page.getByText(/^Today: .+: /)).toBeVisible();
  await expect(page.getByText('No comparable improvement recorded yet.')).toBeVisible();
  await button(page, '45 min').click();
  await expect(page.locator('.card.row', { hasText: 'Start my session' })).toContainText('45 min ·');
  await button(page, '60 min').click();
  await expect(page.locator('.card.row', { hasText: 'Start my session' })).toContainText('60 min');
  await button(page, '20 min').click();
  await openFocus(page);
  await expect(page.getByText('Other unlocked')).toBeVisible();
  await expect(page.locator('.card.row', { hasText: 'Start' })).toHaveCount(4);
  await expect(page.getByText('Locked: everything after those (complete the one before it).')).toBeVisible();
  for (const b of ['Build a longer session', 'No-ball picture quiz', 'Anchor check · due', 'Repeat a completed session']) await expect(button(page, b)).toBeVisible();
  await button(page, 'Repeat a completed session').click();
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
});

test('head-up slalom: digits flash during the timed run and are listed for scoring', async ({ page }) => {
  await boot(page);
  await setup(page);
  await patchSettings(page, { cueEngine: false });
  await place(page, 'Dribbling', 7);
  await start(page, 'Dribbling · Stage 2 · Session 7');
  // Block 2 is D4: the practice view shows a big digit.
  await advance(page, 191_000);
  await startBlockNow(page);
  await advance(page, 10_500);
  await expect(page.locator('.practice')).toContainText(/^.*\d/);
  const digit = page.locator('.practice > div').filter({ hasText: /^\d$/ });
  await expect(digit).toHaveCount(1);
  await button(page, 'DONE').click();
  await button(page, /^Next/).click();
  // Jump to the benchmark (DB head-up).
  await advance(page, 61_000);
  await button(page, 'Skip block').click(); // D5
  await expect(page.getByRole('heading', { name: /Slalom time and control/i })).toBeVisible();
  await startBlockNow(page);
  await advance(page, 10_500);
  for (const _ of [0, 1]) {
    await page.clock.runFor(8_100);
    await page.clock.runFor(10_000);
    await expect(page.locator('.finish-target')).toContainText(/\d/);
    await page.getByRole('button', { name: 'Finish' }).click();
  }
  await expect(page.getByText(/Digits shown in order: \d( \d)+/)).toBeVisible();
  await expect(page.locator('.count', { hasText: 'digits /8' })).toHaveCount(2);
  await expect(page.getByText('layout v1 · level headup')).toBeVisible();
});

test('return after a gap: "First session in N days"', async ({ page }) => {
  await boot(page);
  await setup(page);
  await place(page, 'Dribbling', 1);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await runToEnd(page);
  await home(page);
  await page.clock.setSystemTime(new Date('2026-11-15T17:00:00'));
  await page.reload();
  await start(page, 'Dribbling · Stage 1 · Session 2');
  await runToEnd(page);
  await expect(page.locator('.card', { hasText: 'Dribbling · Session 2' })).toContainText(/First session in 12 days: complete\. Session 3 is unlocked\./);
  await home(page);
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 3')).toBeVisible();
});
