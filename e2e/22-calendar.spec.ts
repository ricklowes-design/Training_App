import { expect, test } from '@playwright/test';
import { boot, button, closeParent, openParent, setup, table } from './helpers';

// Weekly allocation and the availability calendar (task 5.3).

test('a light day in the calendar suggests a light session; the allocation is saved per area', async ({ page }) => {
  await boot(page, { clock: false });
  await setup(page);
  await openParent(page, /^Settings/);
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await page.getByLabel(`Day ${iso}`).selectOption('light');
  const feint = page.locator('.row', { hasText: 'Feinting' }).first();
  await button(feint, '2×').click();
  await expect.poll(async () => (await table<{ availability?: { date: string; kind: string }[]; allocation?: Record<string, number> }>(page, 'settings'))[0].availability).toEqual([{ date: iso, kind: 'light' }]);
  const [s] = await table<{ allocation?: Record<string, number> }>(page, 'settings');
  expect(Object.values(s.allocation ?? {})).toContain(2);
  await closeParent(page);
  await expect(page.getByText('Light day in the calendar: a light session is suggested.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Light' })).toBeChecked();
});
