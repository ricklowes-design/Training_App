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

  // Your space, 1: measure the room wall to wall, with a live plan.
  await expect(page.getByRole('heading', { name: "Let's start with measuring your space" })).toBeVisible();
  await page.getByLabel('Room length metres').fill('4.3');
  await page.getByLabel('Room width metres').fill('2.8');
  await expect(page.getByTestId('room-map')).toContainText('4.3 m long');
  await expect(page.getByText('Follow the steps above')).toBeVisible(); // the set-up's own Next waits
  await button(page, 'Next: take a photo of the space').click();
  // 2: the Chromebook where it will stand, and a photo (Chromium's fake webcam).
  await expect(page.getByRole('heading', { name: 'Position the Chromebook and take a photo' })).toBeVisible();
  // Going back: the set-up's own Back returns to the previous room step, and the step bar opens any step.
  await page.getByRole('button', { name: 'Back', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: "Let's start with measuring your space" })).toBeVisible();
  await expect(page.getByLabel('Room length metres')).toHaveValue('4.3');
  await button(page, '2 Photo').click();
  await expect(page.getByRole('heading', { name: 'Position the Chromebook and take a photo' })).toBeVisible();
  await expect(button(page, 'Take the photo')).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await button(page, 'Take the photo').click();
  // The photo just taken is shown first: retake or use it.
  await expect(page.getByTestId('photo-taken')).toBeVisible();
  await button(page, 'Use this photo').click();
  // 3: "now measure these": furniture is looked for in the photo; anything else is tapped.
  await expect(page.getByRole('heading', { name: 'Now measure these for me' })).toBeVisible();
  await expect(page.getByTestId('detect-status')).not.toContainText('Looking', { timeout: 90_000 });
  const n0 = await page.locator('[data-testid^="space-item-"]').count();
  const photo = page.getByTestId('space-photo');
  const tap = async (x: number, y: number) => {
    const b = (await photo.boundingBox())!;
    await page.mouse.click(b.x + x * b.width, b.y + y * b.height);
  };
  await tap(0.15, 0.6);
  const couch = page.getByTestId(`space-item-${n0}`);
  await couch.getByLabel(`Thing ${n0 + 1} name`).fill('Couch');
  await couch.getByLabel(`Thing ${n0 + 1} place`).selectOption('left');
  await couch.getByLabel('A: From the back wall to the near end of the couch (the end nearest the Chromebook) metres').fill('2');
  await couch.getByLabel('B: From the couch straight across to the right wall metres').fill('1.9');
  await button(page, 'marks the back-left corner').click();
  await tap(0.25, 0.35);
  await tap(0.75, 0.35); // then the back-right corner
  await tap(0.85, 0.6);
  const shelf = page.getByTestId(`space-item-${n0 + 1}`);
  await shelf.getByLabel(`Thing ${n0 + 2} name`).fill('Bookcase');
  await shelf.getByLabel(`Thing ${n0 + 2} place`).selectOption('right');
  await shelf.getByLabel('A: From the back wall to the near end of the bookcase (the end nearest the Chromebook) metres').fill('1');
  await shelf.getByLabel('B: From the bookcase straight across to the left wall metres').fill('2.5');
  // Detected furniture left unmeasured does not narrow the space.
  await button(page, 'Next: your training space').click();
  // 4: the training space worked out from the measurements, and the photo redrawn from above.
  const space = page.getByTestId('training-space');
  await expect(space).toContainText('Training space: 1.6 m wide × 4.3 m long (the room less the couch on the left, the bookcase on the right)');
  await expect(space).toContainText('each drill shows where its cones go');
  await expect(space.getByTestId('floor-image')).toHaveCount(1, { timeout: 15_000 });
  await expect(space.getByTestId('space-item')).toHaveCount(2);
  await expect(page.getByTestId('layout-diagram-L1')).toHaveCount(0); // no cone layouts at set-up
  await button(page, 'Next').click();

  await page.getByLabel('Spare phone (for a cue screen)').check();
  await button(page, 'Next').click();
  // Your ball: the ball check with the webcam (optional; skipped here).
  await expect(page.getByRole('heading', { name: 'Set-up · Your ball' })).toBeVisible();
  await expect(page.getByTestId('ball-check')).toContainText('Which ball works best?');
  await button(page, 'Next').click();
  await page.getByLabel('Coach notes so far (optional; the first entry in the coach log)').fill('Work on the left foot');
  await button(page, 'Next').click();

  // No demonstrations step: the drills come with their videos and animations.
  await expect(page.getByText('Use an outside video')).toHaveCount(0);

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
  expect(layouts[0]).toMatchObject({ version: 1, roomLengthM: 4.3, roomWidthM: 1.6, roomProfileId: 'room-1' });
  const [room] = await table<{ name: string; spaceSource: string; measured: boolean; approxUsableM: object; space: { items: { label: string }[] }; floorMap: { covers: string }; backgroundFrame: unknown }>(page, 'roomProfiles');
  expect(room).toMatchObject({ name: 'Main room', spaceSource: 'approxDims', measured: true, approxUsableM: { length: 4.3, width: 1.6 }, floorMap: { covers: 'room' } });
  expect(room.space.items.map((x) => x.label)).toEqual(expect.arrayContaining(['Couch', 'Bookcase']));
  expect(room.backgroundFrame).toBeTruthy();
  const [settings] = await table<{ equipment: { sparePhone: boolean }; pinHash: string; priorities: string[]; firstRunDone: boolean }>(page, 'settings');
  expect(settings.equipment.sparePhone).toBe(true);
  expect(settings.pinHash).toMatch(/^[0-9a-f]{64}$/);
  expect(settings.firstRunDone).toBe(true);
  expect((await table<{ body: string }>(page, 'coachNotes'))[0].body).toBe('Work on the left foot');
  expect(await table(page, 'overrides')).toHaveLength(0);

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
  await expect(page.getByText(/version 0\.5\.3 .* loaded and valid: 26 drills, 64 sessions/)).toBeVisible();
  for (const id of ['S1', 'S6', 'F1', 'F8', 'D1', 'D6', 'C1', 'C6']) await expect(page.getByRole('cell', { name: id, exact: true })).toBeVisible();
  await page.locator('tr', { hasText: 'F3' }).getByRole('button', { name: 'Adjust' }).click();
  await expect(page.getByRole('heading', { name: /F3 · Scissors/ })).toBeVisible();
});

test('PWA: manifest, service worker and offline reload', async ({ page, context }) => {
  await page.goto('/');
  const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
  expect(manifest).toMatchObject({ display: 'fullscreen', start_url: './' });
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15_000 });
  // Once the worker has taken over, a reload is controlled by it (on a slow machine that can take a second reload).
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.evaluate(() => !!navigator.serviceWorker.controller);
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
  await setup(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Sam · Week of/);
  await context.setOffline(false);
});
