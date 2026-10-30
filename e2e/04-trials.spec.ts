import { expect, test, type Page } from '@playwright/test';
import { boot, button, closeParent, CONTENT_VERSION, CONTENT_VERSION_RE, fillForm, home, openParent, patchSettings, place, runToEnd, setup, start, startCard, table } from './helpers';

type Rec = { id: string; sessionNumber: number; trial: boolean; promotedAt?: string; demotedAt?: string; demoteReason?: string; unlockRetained?: boolean };

async function ready(page: Page) {
  await boot(page);
  await setup(page);
  await place(page, 'Dribbling', 1);
}

test('trial is suggested on a first drill run; a trial counts for nothing until Keep this', async ({ page }) => {
  await ready(page);
  const card = startCard(page, 'Dribbling · Stage 1 · Session 1');
  await expect(card.getByRole('checkbox')).toBeChecked();
  await expect(card).toContainText('First run of D1.');
  await start(page, 'Dribbling · Stage 1 · Session 1', { trial: true });
  await runToEnd(page);
  const summary = page.locator('.card', { hasText: 'Dribbling · Session 1' });
  await expect(summary).toContainText('trial');
  await expect(summary).toContainText('Trial saved. Nothing from it counts until Keep this is pressed.');
  await expect(summary).not.toContainText('is unlocked');
  // Not counted: Week tab and the next session are unchanged.
  await home(page);
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 1')).toBeVisible();
  await expect(page.getByText('0 of 3 planned done')).toBeVisible();
  await button(page, 'Progress').click();
  await expect(page.getByText('No completed sessions this week.')).toBeVisible();
  // Keep it from Parent → Trials: it keeps its date and unlocks.
  await button(page, 'Home').click();
  await openParent(page, /^Trials/);
  const row = page.locator('li', { hasText: 'Dribbling S1' });
  await button(row, 'Keep this').click();
  await expect(page.getByText('None.').first()).toBeVisible();
  await closeParent(page);
  await home(page);
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 2')).toBeVisible();
  await expect(page.getByText('1 of 3 planned done')).toBeVisible();
  const [rec] = await table<Rec & { date: string }>(page, 'sessionRecords');
  expect(rec.trial).toBe(true);
  expect(rec.promotedAt! > rec.date).toBe(true); // kept later, original date unchanged
  expect(new Date(rec.date).getTime() - new Date('2026-11-03T17:00:00').getTime()).toBeLessThan(10_000);
});

test('Keep this on the summary; Report a problem is saved for the coding agent', async ({ page }) => {
  await ready(page);
  await start(page, 'Dribbling · Stage 1 · Session 1', { trial: true });
  await runToEnd(page);
  await page.getByPlaceholder('Report a problem (what went wrong?)').fill('the timer skipped');
  await button(page, 'Report a problem').click();
  await expect(page.getByText('Problem report saved.')).toBeVisible();
  await button(page, 'Keep this').click();
  await expect(page.locator('.card', { hasText: 'Dribbling · Session 1' })).toContainText('Dribbling Session 2 is unlocked.');
  const [report] = await table<{ note: string; appVersion: string; contentVersion: string }>(page, 'problemReports');
  expect(report).toMatchObject({ note: 'the timer skipped', appVersion: '0.1.0', contentVersion: CONTENT_VERSION });
  await home(page);
  await openParent(page, /^Trials/);
  await expect(page.getByText(new RegExp(`app 0\\.1\\.0 · content ${CONTENT_VERSION_RE}: the timer skipped`))).toBeVisible();
});

test('Keep this drill on a trial end-of-drill card keeps that benchmark result only', async ({ page }) => {
  await boot(page);
  await setup(page);
  await patchSettings(page, { cueEngine: false });
  await place(page, 'Ball control', 3);
  await start(page, 'Ball control · Stage 1 · Session 3', { trial: true });
  await runToEnd(page, {
    onForm: async (p) => {
      await (await fillForm(p)).click();
      await button(p, 'Keep this drill').click();
      await expect(button(p, 'Kept')).toBeDisabled();
    },
  });
  const [res] = await table<{ keptAt?: string }>(page, 'benchmarkResults');
  expect(res.keptAt).toBeTruthy();
  // The session itself is still a trial: nothing unlocked.
  await home(page);
  await expect(startCard(page, 'Ball control · Stage 1 · Session 3')).toBeVisible();
  // The kept result shows in the drill view.
  await button(page, 'Progress').click();
  await button(page, 'Drills').click();
  await expect(page.locator('li', { hasText: 'CB · V-pulls' }).getByRole('button')).toHaveText('1 result');
});

test('Make this a trial reverses the unlock when nothing depends on it', async ({ page }) => {
  await ready(page);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await runToEnd(page);
  await home(page);
  await openParent(page, /^Trials/);
  await page.locator('li', { hasText: 'Dribbling S1' }).getByRole('button', { name: 'Make this a trial' }).click();
  await expect(button(page.locator('.modal'), 'Make this a trial')).toBeDisabled(); // reason required
  await page.getByLabel('Reason (required)').fill('timer bug');
  await button(page.locator('.modal'), 'Make this a trial').click();
  await closeParent(page);
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 1')).toBeVisible();
  const [rec] = await table<Rec>(page, 'sessionRecords');
  expect(rec).toMatchObject({ demoteReason: 'timer bug', unlockRetained: false });
  const history = await table<{ action: string; detail: string }>(page, 'history');
  expect(history.some((h) => h.action === 'make trial' && h.detail.includes('timer bug'))).toBe(true);
});

test('Make this a trial keeps the unlock when a later session depends on it', async ({ page }) => {
  await ready(page);
  for (const n of [1, 2]) {
    await start(page, `Dribbling · Stage 1 · Session ${n}`);
    await runToEnd(page);
    await home(page);
  }
  await openParent(page, /^Trials/);
  await page.locator('li', { hasText: 'Dribbling S1' }).first().getByRole('button', { name: 'Make this a trial' }).click();
  await page.getByLabel('Reason (required)').fill('wrong drill');
  await button(page.locator('.modal'), 'Make this a trial').click();
  await closeParent(page);
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 3')).toBeVisible();
  await expect(page.getByText('1 of 3 planned done')).toBeVisible(); // the demoted one no longer counts
  const recs = await table<Rec>(page, 'sessionRecords');
  expect(recs.find((r) => r.sessionNumber === 1)).toMatchObject({ unlockRetained: true });
});

test('a parent trial period forces trials; an app update suggests one', async ({ page }) => {
  await ready(page);
  await openParent(page, /^Trials/);
  await page.locator('input[type=date]').fill('2026-11-10');
  await button(page, 'Save').click();
  await closeParent(page);
  const card = startCard(page, 'Dribbling · Stage 1 · Session 1');
  await expect(card.getByRole('checkbox')).toBeChecked();
  await expect(card.getByRole('checkbox')).toBeDisabled();
  await expect(card).toContainText('All sessions are trials until 2026-11-10.');
  // Clear the period; pretend the last session was on an older app version.
  await patchSettings(page, { trialUntil: undefined, lastSeenAppVersion: '0.0.1' });
  await page.reload();
  await expect(card).toContainText('First run of D1.'); // no records yet: update reason not shown
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await runToEnd(page);
  await home(page);
  await patchSettings(page, { lastSeenAppVersion: '0.0.1' });
  await page.reload();
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 2')).toContainText('First session after an app update.');
});
