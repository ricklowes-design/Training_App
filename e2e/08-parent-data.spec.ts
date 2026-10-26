import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PIN, boot, button, captureSpeech, closeParent, home, openParent, parentMenu, patchSettings, place, runToEnd, setup, start, startCard, table, openFocus } from './helpers';

async function ready(page: Page) {
  await boot(page);
  await setup(page);
  await patchSettings(page, { cueEngine: false });
}

test('backup: export → clear site data → restore on the first screen → everything back', async ({ page, browser }) => {
  await ready(page);
  await place(page, 'Dribbling', 1);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await runToEnd(page);
  await home(page);
  await openParent(page, /^Coach notes/);
  await page.getByPlaceholder(/Smaller scissors/).fill('keep this note');
  await button(page, 'Save note').click();
  await parentMenu(page);
  await button(page, /^Backup/).click();
  await expect(page.getByText(/Last backup: Nov 3, 2026/)).toBeVisible(); // set-up counts as the first reminder point
  const [dl] = await Promise.all([page.waitForEvent('download'), button(page, 'Export backup').click()]);
  expect(dl.suggestedFilename()).toBe('home-training-backup-2026-11-03.json');
  const path = await dl.path();
  const backup = JSON.parse(readFileSync(path!, 'utf8'));
  expect(backup.format).toBe('home-training-backup');
  expect(backup.tables.sessionRecords).toHaveLength(1);
  await expect(page.getByText(/Backup saved to Downloads \(1 sessions\)/)).toBeVisible();

  // A new browser profile = cleared site data.
  const fresh = await browser.newContext();
  const p2 = await fresh.newPage();
  await p2.goto('/');
  await expect(p2.getByRole('heading', { name: 'Set-up · Player' })).toBeVisible();
  await p2.locator('input[type=file]').setInputFiles(path!);
  await expect(p2.getByRole('heading', { level: 1 })).toHaveText(/^Sam · Week of/);
  await openFocus(p2);
  await expect(p2.locator('.card.row', { hasText: 'Dribbling · Stage 1 · Session 2' })).toBeVisible();
  await p2.getByRole('button', { name: 'Parent mode' }).click();
  await p2.getByLabel('PIN', { exact: true }).fill(PIN); // the PIN came back too
  await p2.getByRole('button', { name: 'Open' }).click();
  await p2.getByRole('button', { name: /^Coach notes/ }).click();
  await expect(p2.getByText('“keep this note”')).toBeVisible();
  await fresh.close();
});

test('backup import in parent mode asks first, replaces everything, and rejects other files', async ({ page }) => {
  await ready(page);
  await openParent(page, /^Backup/);
  const input = page.locator('input[type=file]');
  await input.setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await button(page.locator('.modal'), 'Replace with backup').click();
  await expect(page.getByText('This file is not a backup from this app.')).toBeVisible();
  await input.setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
  await button(page.locator('.modal'), 'Cancel').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  const empty = { format: 'home-training-backup', formatVersion: 1, exportedAt: '', appVersion: '0.1.0', tables: { settings: (await table(page, 'settings')), player: [{ id: 'main', name: 'Robin', dominantFoot: 'right', position: '' }] } };
  await input.setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(empty)) });
  await button(page.locator('.modal'), 'Replace with backup').click();
  await expect(page.getByText(/Restored: 0 sessions/)).toBeVisible();
  await closeParent(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Robin · Week of/);
});

test('the monthly backup reminder shows when a backup is due', async ({ page }) => {
  await ready(page);
  await patchSettings(page, { lastBackupAt: '2026-09-01T00:00:00.000Z' });
  await page.reload();
  await expect(page.getByText('A backup is due. A parent can make one in Parent → Backup.')).toBeVisible();
  await openParent(page);
  await expect(page.getByText('A backup is due (monthly reminder).')).toBeVisible();
  await button(page, 'Back up now').click();
  await expect(page.getByRole('heading', { name: 'Backup' })).toBeVisible();
});

test('settings: sound, week, timings, cue engine, milestone cards and PIN', async ({ page }) => {
  const said = await captureSpeech(page);
  await ready(page);
  await openParent(page, /^Settings/);
  await button(page, 'Test sound from the far end').click();
  expect(await said()).toContain('Set two. Left exit. Go. Thirty seconds.');
  await page.getByLabel('Spoken cues').click();
  await expect(page.getByLabel('Spoken cues')).not.toBeChecked();
  await button(page, 'Test sound from the far end').click();
  expect((await said()).length).toBe(1); // speech off: nothing more said
  await page.getByLabel(/^Tones/).click();
  await page.locator('.stepper', { hasText: 'Weekly target' }).getByRole('button', { name: /up$/ }).click();
  await button(page, 'Sunday').click();
  await page.locator('.stepper', { hasText: 'End-of-drill card' }).getByRole('button', { name: /down$/ }).click();
  await page.getByLabel(/^Cue engine/).click();
  await page.getByLabel('Milestone cards').click();
  await page.getByLabel(/A partner is usually available/).click();
  await page.locator('input[type=password]').fill('4321');
  await button(page, 'Change PIN').click();
  await expect(page.getByText('PIN changed.')).toBeVisible();
  const [s] = await table<{ sound: { speech: boolean; tones: boolean }; weeklyTarget: number; weekStartDay: number; cardAutoAdvanceS: number; cueEngine: boolean; milestoneCards: boolean; partnerAvailable: boolean }>(page, 'settings');
  expect(s).toMatchObject({ sound: { speech: false, tones: false }, weeklyTarget: 4, weekStartDay: 0, cardAutoAdvanceS: 15, cueEngine: true, milestoneCards: false, partnerAvailable: true });
  await closeParent(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Week of Nov 1/); // Sunday start
  await expect(page.getByText('0 of 4 planned done')).toBeVisible();
  // New PIN.
  await button(page, 'Parent mode').click();
  await page.getByLabel('PIN', { exact: true }).fill(PIN);
  await button(page, 'Open').click();
  await expect(page.getByText('Wrong PIN.')).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill('4321');
  await button(page, 'Open').click();
  await expect(page.getByRole('heading', { name: 'Parent and coach mode' })).toBeVisible();
});

test('milestone cards off: no card after a first session', async ({ page }) => {
  await ready(page);
  await patchSettings(page, { milestoneCards: false });
  await place(page, 'Dribbling', 1);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await runToEnd(page);
  await button(page, 'Done').click();
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 2')).toBeVisible();
  await expect(page.getByText(/First completed Dribbling session/)).toHaveCount(0);
});

test('room profiles: an unchanged save makes no new layout; a narrower space does; a too-small space refuses drills', async ({ page }) => {
  await ready(page);
  await openParent(page, /^Room profiles/);
  const edit = () => page.locator('li', { hasText: 'Main room' }).getByRole('button', { name: 'Edit' }).click();
  await edit();
  await button(page, 'Save and close').click();
  await expect(page.locator('li', { hasText: /^v\d+ ·/ })).toHaveCount(1);
  await edit();
  await button(page, 'Measure it').click();
  await page.getByText(/^Drill layouts in this space/).click();
  await page.getByLabel('Clear floor width metres').fill('2.5');
  await expect(page.getByText(/1 m square mid-room/)).toBeVisible(); // receive box shrinks with the width
  await button(page, 'Save and close').click();
  await expect(page.locator('li', { hasText: /^v2 ·/ })).toContainText('about 6.1 × 2.5 m');
  await expect(page.locator('li', { hasText: /^v1 ·/ })).toContainText('about 6.1 × 3 m');
  // Shrink the safe space below even the single-cone versions: the receiving drills are refused.
  await edit();
  await page.getByText(/^Drill layouts in this space/).click();
  await page.getByLabel('Clear floor width metres').fill('1.1');
  await expect(page.getByText(/Not available here: the receiving drills need about 1.2 m of clear width/)).toBeVisible();
  await expect(page.getByTestId('layout-diagram-L3')).toContainText('Not available in this room');
  await button(page, 'Save and close').click();
  await closeParent(page);
  await place(page, 'Scanning', 1);
  const card = startCard(page, 'Scanning · Stage 1 · Session 1');
  await expect(card).toContainText('Not available in this room: Receive box');
  await expect(button(card, 'Start')).toBeDisabled();
});

test('room profiles: a second room can be added and switched to without measuring', async ({ page }) => {
  await ready(page);
  await openParent(page, /^Room profiles/);
  await button(page, 'New room (no tape: pick a size)').click();
  await page.getByLabel('Profile name').fill('Garage');
  await page.getByLabel(/^Extended/).check();
  await button(page, 'Save and close').click();
  await expect(page.locator('li', { hasText: 'Garage' }).first()).toContainText('extended');
  await expect(page.locator('li', { hasText: 'Garage' }).first()).toContainText('in use');
  await expect(page.locator('li', { hasText: /^v2 ·/ })).toContainText('Garage');
  await button(page.locator('li', { hasText: 'Main room' }).first(), 'Use this room').click();
  await expect(page.locator('li', { hasText: 'Main room' }).first()).toContainText('in use');
  // Switching back reuses the room's own layout version.
  await expect(page.locator('li', { hasText: /^v\d+ ·/ })).toHaveCount(2);
});
