import { expect, test } from '@playwright/test';
import { conesVideo } from './fake-video';
import { boot, button, openParent, patchSettings, setup, table } from './helpers';

// Experimental cone detection (off by default) on a colour camera picture with four orange cones.

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--use-file-for-fake-video-capture=${conesVideo()}`] } });

const FLAGS = { defender3d: true, liveOnsetDetector: false, speechDiagnostic: false, notifications: false, ballTracking: false, learning: false, coneDetection: false, neuralBallDetector: false };
test('off by default; when on, finds the cones in the photo and moves the markers onto them for the parent to confirm', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, { clock: false });
  await setup(page);
  const [s] = await table<{ flags: { coneDetection: boolean } }>(page, 'settings');
  expect(s.flags.coneDetection).toBe(false);
  await openParent(page, /^Room profiles/);
  await page.locator('li', { hasText: 'Main room' }).getByRole('button', { name: 'Edit' }).click();
  await button(page, 'Next').click();
  await expect(button(page, 'Take room photo')).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await button(page, 'Take room photo').click();
  for (let i = 0; i < 3; i++) await button(page, 'Next').click();
  await button(page, /^L4 /).click();
  await expect(button(page, 'Confirm L4 positions')).toBeVisible();
  await expect(button(page, 'Find cones in the photo')).toHaveCount(0); // switched off
  await patchSettings(page, { flags: { ...FLAGS, coneDetection: true } });
  await page.reload();
  await openParent(page, /^Room profiles/);
  await page.locator('li', { hasText: 'Main room' }).getByRole('button', { name: 'Edit' }).click();
  await button(page, 'Next').click();
  await expect(button(page, 'Take room photo')).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await button(page, 'Take room photo').click();
  await button(page, 'Next').click(); // floor map
  await button(page, 'Next').click(); // anchors
  await button(page, 'Next').click(); // safe floor
  await button(page, /^L4 /).click();
  await expect(button(page, 'Find cones in the photo')).toBeVisible();
  await button(page, 'Find cones in the photo').click();
  await expect(page.locator('.note-box')).toContainText(/found 4 cone-coloured object\(s\); moved \d of 4 markers/);
  await expect(page.locator('.note-box')).toContainText('Check every marker');
  await button(page, 'Confirm L4 positions').click();
  await expect(page.getByText(/L4 cone positions confirmed/)).toBeVisible();
  const [inst] = await table<{ observedConePositionsNormalized: { pt: { x: number; y: number } }[] }>(page, 'layoutInstances');
  // Markers that moved sit on the cones' bases (y 0.61 or 0.83 of the picture).
  const ys = inst.observedConePositionsNormalized.map((c) => c.pt.y);
  expect(ys.some((y) => Math.abs(y - 0.61) < 0.03 || Math.abs(y - 0.83) < 0.03)).toBe(true);
});
