import { expect, test } from '@playwright/test';
import { boot, button, closeParent, openParent, PIN, setup, table } from './helpers';

test('first-run set-up saves the player, room layout v1, priorities, coach note and PIN', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Set-up · Player' })).toBeVisible();
  await expect(button(page, 'Next')).toBeDisabled(); // name required
  await page.getByLabel("Player's first name").fill('Sam');
  await button(page, 'Left').click();
  await page.getByLabel('Position').fill('winger');
  await button(page, 'Next').click();

  // Room: measured once (length, width, fixed points), with a live plan of the room and no cone layouts yet.
  await expect(page.getByLabel('Clear floor length metres')).toBeVisible();
  await page.getByLabel('Clear floor length metres').fill('4.3');
  await page.getByLabel('Clear floor width metres').fill('1.9');
  await expect(page.getByTestId('room-map')).toContainText('4.3 m long');
  await button(page, '+ Add a fixed point').click();
  await page.getByLabel('Reference point 1 name').fill('Door frame');
  await page.getByLabel('Reference point 1 side').selectOption('right');
  await page.getByLabel('Reference point 1: distance from the back wall metres').fill('1.7');
  await expect(page.getByTestId('room-map').getByTestId('landmark')).toContainText('Door frame');
  await expect(page.getByTestId('layout-diagram-L1')).toHaveCount(0); // cones come with each drill
  // No tape: a size class is enough; layouts follow it.
  await button(page, 'No tape: pick a size').click();
  await expect(page.getByLabel(/^Standard: about 6 × 3 m/)).toBeChecked();
  await button(page, 'Measure it').click();
  await page.getByLabel('Clear floor length metres').fill('6.1');
  await page.getByLabel('Clear floor width metres').fill('3');
  await button(page, 'Next').click();

  await page.getByLabel('Spare phone (for a cue screen)').check();
  await button(page, 'Next').click();
  await page.getByLabel('Coach notes so far (optional; the first entry in the coach log)').fill('Work on the left foot');
  await button(page, 'Next').click();

  // Demonstrations: choose an outside link for one core move.
  const f3 = page.locator('.card.tight', { hasText: 'F3 ·' });
  await button(f3, 'Use an outside video').click();
  await f3.getByLabel(/YouTube link/).fill('https://www.youtube.com/watch?v=abcdefghijk');
  await button(page, 'Next').click();

  await expect(button(page, 'Finish set-up')).toBeDisabled(); // PIN required
  await page.getByLabel('Parent PIN (4 digits)').fill('12');
  await expect(button(page, 'Finish set-up')).toBeDisabled();
  await page.getByLabel('Parent PIN (4 digits)').fill(PIN);
  await button(page, 'Finish set-up').click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Sam · Week of Nov 2/);
  const [player] = await table<{ name: string; dominantFoot: string; position: string }>(page, 'player');
  expect(player).toMatchObject({ name: 'Sam', dominantFoot: 'left', position: 'winger' });
  const layouts = await table<{ version: number; derived: { slalomSpacingM: number } }>(page, 'layouts');
  expect(layouts).toHaveLength(1);
  expect(layouts[0]).toMatchObject({ version: 1, derived: { slalomSpacingM: 1 }, roomProfileId: 'room-1' });
  const [room] = await table<{ name: string; spaceSource: string; usableSpaceClass: string; measured: boolean; landmarks: { label: string; side: string; alongM: number }[] }>(page, 'roomProfiles');
  expect(room).toMatchObject({ name: 'Main room', spaceSource: 'approxDims', usableSpaceClass: 'standard', measured: true });
  expect(room.landmarks).toEqual([expect.objectContaining({ label: 'Door frame', side: 'right', alongM: 1.7 })]);
  const [settings] = await table<{ equipment: { sparePhone: boolean }; pinHash: string; priorities: string[]; firstRunDone: boolean }>(page, 'settings');
  expect(settings.equipment.sparePhone).toBe(true);
  expect(settings.pinHash).toMatch(/^[0-9a-f]{64}$/);
  expect(settings.firstRunDone).toBe(true);
  expect((await table<{ body: string }>(page, 'coachNotes'))[0].body).toBe('Work on the left foot');
  const overrides = await table<{ target: { id: string }; value: { ref: string } }>(page, 'overrides');
  expect(overrides[0]).toMatchObject({ target: { id: 'F3' }, value: { ref: 'https://www.youtube.com/watch?v=abcdefghijk' } });

  // Reload: set-up is not shown again.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Sam · Week of/);
});

test('parent mode needs the PIN', async ({ page }) => {
  await boot(page);
  await setup(page);
  await button(page, 'Parent mode').click();
  await page.getByLabel('PIN', { exact: true }).fill('9999');
  await button(page, 'Open').click();
  await expect(page.getByText('Wrong PIN.')).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill(PIN);
  await button(page, 'Open').click();
  await expect(page.getByRole('heading', { name: 'Parent and coach mode' })).toBeVisible();
  await closeParent(page);
  // Closing parent mode locks it again.
  await button(page, 'Parent mode').click();
  await expect(page.getByLabel('PIN', { exact: true })).toBeVisible();
});

test('parent can re-run the first-run set-up and change the player', async ({ page }) => {
  await boot(page);
  await setup(page);
  await openParent(page);
  await button(page, 'Re-run first-run set-up').click();
  await page.getByLabel("Player's first name").fill('Alex');
  for (let i = 0; i < 5; i++) await button(page, 'Next').click();
  await expect(page.getByLabel(/New parent PIN/)).toBeVisible();
  await button(page, 'Finish set-up').click(); // keeps the PIN
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Alex · Week of/);
  expect(await table(page, 'layouts')).toHaveLength(1); // room unchanged: no new version
});

test('a broken content file shows a readable error and keeps saved data', async ({ page }) => {
  await page.route('**/content/programme.json', async (route) => {
    const res = await route.fetch();
    const text = (await res.text()).replace('"version": "', '"version" "');
    await route.fulfill({ response: res, body: text });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The programme content has a problem' })).toBeVisible();
  await expect(page.getByText(/not valid JSON near line \d+, column \d+/)).toBeVisible();
});

test('a content field with the wrong type is named', async ({ page }) => {
  await page.route('**/content/programme.json', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.drills[0].cues = 'one cue';
    await route.fulfill({ response: res, json });
  });
  await page.goto('/');
  await expect(page.getByText('drills[0].cues: expected a list, found text "one cue"')).toBeVisible();
});

test('Parent → Content lists every drill by area', async ({ page }) => {
  await boot(page);
  await setup(page);
  await openParent(page, /^Content/);
  await expect(page.getByText(/version 0\.5\.2 .* loaded and valid: 26 drills, 64 sessions/)).toBeVisible();
  for (const id of ['S1', 'S6', 'F1', 'F8', 'D1', 'D6', 'C1', 'C6']) await expect(page.getByRole('cell', { name: id, exact: true })).toBeVisible();
  await page.locator('tr', { hasText: 'F3' }).getByRole('button', { name: 'Adjust' }).click();
  await expect(page.getByRole('heading', { name: /F3 · Scissors/ })).toBeVisible();
});

test('PWA: manifest, service worker and offline reload', async ({ page, context }) => {
  await page.goto('/');
  const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
  expect(manifest).toMatchObject({ display: 'fullscreen', start_url: './' });
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15_000 });
  await page.reload(); // now controlled by the service worker
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await setup(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Sam · Week of/);
  await context.setOffline(false);
});
