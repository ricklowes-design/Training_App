import { expect, type Page } from '@playwright/test';
import { button, closeParent, openParent } from './helpers';

/** Parent → Camera set-up for one family: photo, four cones, zones (+ tripwire), mirror check. */
export async function cameraSetup(page: Page, family: 'L1' | 'L2', opts: { enable?: boolean } = {}): Promise<void> {
  await openParent(page, /^Camera set-up/);
  if (opts.enable !== false) {
    const box = page.getByLabel(/^Camera on/);
    if (!(await box.isChecked())) {
      await box.click();
      await expect(box).toBeChecked();
    }
  }
  const name = family === 'L2' ? 'Feinting (L2' : 'Dribbling (L1';
  await page.locator('.card.row', { hasText: name }).getByRole('button', { name: /Set up|Redo set-up/ }).click();
  await expect(button(page, 'Take reference photo')).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(800); // let the stream show a frame
  await button(page, 'Take reference photo').click();
  const img = page.locator('img[alt="Reference photo"]');
  await expect(img).toBeVisible();
  const tap = async (x: number, y: number) => {
    const b = (await img.boundingBox())!;
    await page.mouse.click(b.x + x * b.width, b.y + y * b.height);
  };
  for (const [x, y] of [[0.5, 0.95], [0.5, 0.5], [0.72, 0.35], [0.28, 0.35]]) await tap(x, y);
  await expect(page.getByText(/Check: place a cone/)).toBeVisible();
  await tap(0.5, 0.7);
  await expect(page.getByText(/It reads -?\d\.\d\d m across, \d\.\d\d m along\./)).toBeVisible();
  await button(page, 'Next: zones').click();
  const zones: [number, number][][] = [
    [[0.05, 0.3], [0.95, 0.3], [0.98, 0.98], [0.02, 0.98]], // drill area
    [[0.62, 0.2], [0.8, 0.2], [0.8, 0.35], [0.62, 0.35]],
    [[0.2, 0.2], [0.38, 0.2], [0.38, 0.35], [0.2, 0.35]],
    [[0.3, 0.05], [0.7, 0.05], [0.7, 0.15], [0.3, 0.15]],
    [[0.2, 0.54], [0.8, 0.54], [0.8, 0.63], [0.2, 0.63]], // tripwire
  ];
  for (let i = 0; i < zones.length; i++) {
    for (const [x, y] of zones[i]) await tap(x, y);
    if (i < zones.length - 1) await button(page, 'Next zone').click();
  }
  await button(page, 'Next: mirror check').click();
  await button(page, /It shows on the LEFT/).click();
  await button(page, 'Save camera set-up').click();
  await expect(page.locator('.card.row', { hasText: name })).toContainText(/Set up .* · 4 zones \+ tripwire · floor calibrated/);
  await closeParent(page);
}
