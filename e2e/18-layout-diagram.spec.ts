import { expect, test } from '@playwright/test';
import { boot, button, openParent, patchSettings, setup } from './helpers';

// Cone layouts follow the room inputs, shown as plans from above, in metres or feet and inches.

const shot = (name: string) => (process.env.SHOTS ? `docs/screens/layouts/${name}.png` : undefined);

test('the cone plans follow the size, the cones and the units', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await boot(page, { clock: false });
  await setup(page);
  await openParent(page, /^Room profiles/);
  await page.locator('li', { hasText: 'Main room' }).getByRole('button', { name: 'Edit' }).click();
  for (const id of ['L1', 'L2', 'L3', 'L4']) await expect(page.getByTestId(`layout-diagram-${id}`)).toBeVisible();
  const l1 = page.getByTestId('layout-diagram-L1');
  await expect(l1).toContainText('FRONT');
  await expect(l1).toContainText('BACK (start wall)');
  await expect(l1).toContainText('Chromebook');
  await expect(page.getByTestId('layout-diagram-L3')).toContainText('behind the player');
  await expect(page.getByTestId('layout-diagram-L3')).toContainText('webcam, low');
  await expect(page.getByText('5 cones 1 m apart, first cone 0.8 m from the back wall')).toBeVisible();
  const grid = page.locator('.layout-grid');
  const s1 = shot('01-standard-metres');
  if (s1) await grid.screenshot({ path: s1 });

  // Feet and inches: the plans and the descriptions change; the size inputs too.
  await button(page, 'Feet and inches').click();
  await expect(page.getByText('5 cones 3 ft 3 in apart, first cone 2 ft 7 in from the back wall')).toBeVisible();
  await expect(l1).toContainText('20 ft long');
  const s2 = shot('02-standard-feet-inches');
  if (s2) await grid.screenshot({ path: s2 });
  await button(page, 'I know it roughly').click();
  await page.getByLabel('Clear floor length feet').fill('14');
  await page.getByLabel('Clear floor length inches').fill('0');
  await page.getByLabel('Clear floor width feet').fill('7');
  await page.getByLabel('Clear floor width inches').fill('6');
  await expect(l1).toContainText('14 ft long');
  await expect(page.getByTestId('layout-diagram-L2')).toContainText(/gates 1 ft 8 in wide/);
  await expect(page.getByText(/receive box needs about 7 ft 10 in of clear width/)).toBeVisible();
  const s3 = shot('03-small-room-feet-inches');
  if (s3) await grid.screenshot({ path: s3 });

  // Fewer cones: the slalom shortens, the feint lane loses its start cone, then refuses.
  await button(page, 'Metres').click();
  await button(page, 'Cancel').click().catch(() => undefined);
  await patchSettings(page, { equipment: { cones: 4, sparePhone: false, tripod: false } });
  await page.reload();
  await openParent(page, /^Room profiles/);
  await page.locator('li', { hasText: 'Main room' }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByText(/^4 cones .* apart/)).toBeVisible();
  await expect(page.getByText('Not available here: needs 5 cones (you have 4).', { exact: false })).toBeVisible();
  const s4 = shot('04-four-cones');
  if (s4) await grid.screenshot({ path: s4 });
});
