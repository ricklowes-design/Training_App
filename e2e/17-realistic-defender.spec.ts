import { expect, test } from '@playwright/test';
import { advance, boot, button, openParent, patchSettings, place, setup, start, startBlockNow, table } from './helpers';

// The realistic defender (recorded human movement), off by default.

const FLAGS = { defender3d: true, realisticDefender: false, liveOnsetDetector: false, speechDiagnostic: false, notifications: false, ballTracking: false, learning: false, coneDetection: false, neuralBallDetector: false };

test('off by default; the 3D defender test shows the recorded movement on request', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, { clock: false });
  await setup(page);
  const [s] = await table<{ flags: { realisticDefender?: boolean } }>(page, 'settings');
  expect(s.flags.realisticDefender).toBe(false);
  await openParent(page, /^Settings/);
  await expect(page.getByText('Realistic defender movement')).toBeVisible();
  await button(page, 'Parent menu').click();
  await button(page, /^3D defender test/).click();
  await button(page, 'Recorded movement (experimental)').click();
  await expect(page.getByTestId('defender-3d')).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.locator('.error-box')).toHaveCount(0);
  await page.getByLabel('Freeze at a moment').check();
  await page.getByLabel('Moment in the rep (s)').fill('3.3');
  await expect(page.getByText(/3\.30 s · commit/)).toBeVisible();
});

test('when on, a reactive drill uses it and records the renderer with each rep', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await setup(page);
  await patchSettings(page, { flags: { ...FLAGS, realisticDefender: true } });
  await page.reload();
  await place(page, 'Feinting', 9);
  await start(page, 'Feinting · Stage 3 · Session 9');
  await advance(page, 191_000);
  await startBlockNow(page);
  await advance(page, 10_500);
  await expect(page.locator('[data-testid="defender-3d"], [data-testid="defender-2d"]')).toBeVisible();
  await page.waitForTimeout(2000); // the 3D module and the clips load in real time
  for (let i = 0; i < 6; i++) await page.clock.runFor(1000);
  await expect(page.locator('.practice.defender')).toContainText(/rep \d+ of 16/);
  await button(page, 'STOP').click();
  const scen = await table<{ rendererVersion: string }>(page, 'defenderScenarios');
  expect(scen.length).toBeGreaterThan(0);
  expect(scen.every((x) => x.rendererVersion.includes('recorded-motion'))).toBe(true);
});
