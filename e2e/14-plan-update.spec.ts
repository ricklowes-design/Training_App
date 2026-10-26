import { expect, test, type Page } from '@playwright/test';
import { stillVideo } from './fake-video';
import { boot, button, closeParent, fillForm, home, openFocus, openParent, runToEnd, setup, table } from './helpers';

// Screens added by the plan update (parts 15–18): room profile with a camera photo, the
// launch room check, validation and the capstone gate, learning, the 3D defender test,
// the timing budget, the ball screen and the optional scanning diagnostic.

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-video-capture=${stillVideo()}`],
  },
});

async function photoTap(page: Page, x: number, y: number) {
  const b = (await page.getByTestId('room-photo').boundingBox())!;
  await page.mouse.click(b.x + x * b.width, b.y + y * b.height);
}

test('room profile: photo, anchors, safe floor and cone overlay, no measuring', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page, { clock: false });
  await setup(page);
  await openParent(page, /^Room profiles/);
  await page.locator('li', { hasText: 'Main room' }).getByRole('button', { name: 'Edit' }).click();
  await button(page, 'Next').click(); // size → photo
  await expect(button(page, 'Take room photo')).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.getByLabel('The camera mount is in its usual place').check();
  await button(page, 'Take room photo').click();
  // Floor map: the four corners of the clear floor tapped on the photo → a top-down picture.
  for (const [x, y] of [[0.3, 0.45], [0.7, 0.45], [0.95, 0.95], [0.05, 0.95]]) {
    const b = (await page.getByTestId('floor-map-photo').boundingBox())!;
    await page.mouse.click(b.x + x * b.width, b.y + y * b.height);
  }
  await button(page, 'Make the top-down map').click();
  await expect(page.getByText(/^Map made/)).toBeVisible();
  await expect(page.getByTestId('floor-image')).toHaveCount(1);
  await button(page, 'Next').click();
  // Anchors.
  await page.getByLabel('Next anchor is a').selectOption('Desk corner');
  await photoTap(page, 0.2, 0.3);
  await page.getByLabel('Next anchor is a').selectOption('Bookcase edge');
  await photoTap(page, 0.8, 0.25);
  await expect(page.locator('li', { hasText: 'Bookcase edge' })).toBeVisible();
  await button(page, 'Next').click();
  // Safe floor.
  for (const [x, y] of [[0.1, 0.95], [0.9, 0.95], [0.8, 0.4], [0.2, 0.4]]) await photoTap(page, x, y);
  await expect(page.getByText(/4 corners · about [\d.]+ × [\d.]+ m \(approximate\)/)).toBeVisible();
  await button(page, 'Next').click();
  // Cone overlay: suggested positions, confirmed.
  await button(page, /^L2 /).click();
  await button(page, 'Confirm L2 positions').click();
  await expect(page.getByText(/L2 cone positions confirmed for layout v\d+/)).toBeVisible();
  await button(page, 'Save and close').click();
  await expect(page.locator('li', { hasText: 'Main room' }).first()).toContainText('photo, 2 anchors');
  await expect(page.locator('li', { hasText: 'Main room' }).first()).toContainText('safe floor drawn');
  const [room] = await table<{ spaceSource: string; anchors: unknown[]; backgroundThumb?: number[]; version: number }>(page, 'roomProfiles');
  expect(room.spaceSource).toBe('polygon');
  expect(room.anchors).toHaveLength(2);
  expect(room.backgroundThumb).toHaveLength(128 * 72);
  expect(await table(page, 'layoutInstances')).toHaveLength(1);
});

test('validation records open the capstone gate one component at a time', async ({ page }) => {
  await boot(page);
  await setup(page);
  await button(page, 'Progress').click();
  await button(page, 'Skills').click();
  const cap = page.locator('.card', { hasText: 'Linked challenge' });
  await expect(cap).toContainText('locked');
  await expect(cap).toContainText('Scan → First touch → Feint → Read the defender → Adapt → Controlled exit');
  await button(page, 'Home').click();
  await openParent(page, /^Validation/);
  const scan = page.locator('.card', { hasText: 'Scan proxy' });
  await scan.getByLabel(/reps compared/).fill('20');
  await scan.getByLabel(/agreed/).fill('18');
  await button(scan, 'Save check').click();
  await expect(scan.locator('.pill')).toHaveText('validated');
  const onset = page.locator('.card', { hasText: 'Feint onset' });
  await onset.getByLabel(/reps compared/).fill('20');
  await onset.getByLabel(/agreed/).fill('12');
  await button(onset, 'Save check').click();
  await expect(onset.locator('.pill')).toHaveText('estimate only');
  await closeParent(page);
  await button(page, 'Progress').click();
  await button(page, 'Skills').click();
  await expect(cap).toContainText('✔ Scan proxy');
  await expect(cap).toContainText('locked');
});

test('parent tools: 3D defender test, timing budget, balls, learning', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, { clock: false });
  await setup(page);
  await openParent(page, /^3D defender test/);
  await expect(page.getByTestId('defender-3d').or(page.locator('.error-box'))).toBeVisible();
  await button(page, 'Hold').click();
  await expect(page.getByText(/Measured: \d+ fps now|Fallback/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('table.data')).toContainText('earlyCommit');
  await expect(page.getByText(/game-design parameters, not real-defender models/)).toBeVisible();
  await button(page, 'Parent menu').click();
  await button(page, /^Timing budget/).click();
  await button(page, 'Measure the timing budget').click();
  await expect(page.getByText('Saved.')).toBeVisible({ timeout: 20_000 });
  const [s] = await table<{ timingBudget: { cameraFps: number; renderFps: number } }>(page, 'settings');
  expect(s.timingBudget.cameraFps).toBeGreaterThan(5);
  await expect(page.getByText(/Camera: \d+ fps/)).toBeVisible();
  await button(page, 'Parent menu').click();
  await button(page, /^Balls/).click();
  await button(page, 'Register new ball').click();
  await expect(page.getByTestId('ball-video')).toBeVisible();
  await expect(button(page, 'Save ball')).toBeDisabled();
  await button(page, 'Cancel').click();
  await button(page, 'Parent menu').click();
  await button(page, /^Learning/).click();
  await expect(page.locator('.card', { hasText: 'Feint execution' })).toContainText('0 verified examples');
  await expect(button(page.locator('.card', { hasText: 'Feint execution' }), 'Try a personalised model')).toBeDisabled(); // personalisation off
  await page.getByLabel('Pause all personalisation').click(); // saved to the database, the box follows
  await expect(page.getByLabel('Pause all personalisation')).toBeChecked();
  expect((await table<{ paused: boolean }>(page, 'learningSettings'))[0].paused).toBe(true);
});

test('the optional scanning diagnostic is an extra with a blank two-number card', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  await setup(page);
  await openFocus(page);
  await button(page, 'Scanning diagnostic (optional)').click();
  await expect(page.getByRole('heading', { name: /Two-item cue \(optional diagnostic\)/ })).toBeVisible();
  await page.getByRole('checkbox').uncheck();
  await button(page, 'Start').click();
  await runToEnd(page, {
    onForm: async (p) => {
      await expect(p.getByText('Scanning diagnostic')).toBeVisible();
      await expect(p.locator('.count[data-blank]')).toHaveCount(2);
      await (await fillForm(p, 7)).click();
    },
  });
  await expect(page.locator('.card').first()).toContainText('saved as an extra');
  await home(page);
  const obs = await table<{ metricId: string; value: number; contextKey: { taskMode?: string } }>(page, 'metricObservations');
  expect(obs.find((o) => o.metricId === 'digitCorrect')).toMatchObject({ value: 7, contextKey: { taskMode: 'digitDiagnostic' } });
});
