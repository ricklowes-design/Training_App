import { expect, test } from '@playwright/test';
import { advance, boot, button, place, setup, start, table } from './helpers';

// CB-1: 30 s of V-pulls per foot on the tone, recorded as windows for the camera; then the gate test.

test('the V-pull test runs a timed window per foot, then the gate test continues', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  await setup(page);
  await place(page, 'Ball control', 3);
  await start(page, 'Ball control · Stage 1 · Session 3');
  await advance(page, 191_000);
  await button(page, 'Skip block').click(); // C1
  await advance(page, 61_000); // rest
  await button(page, 'Skip block').click(); // C2
  await expect(page.getByRole('heading', { name: /Benchmark · V-pulls and outside-touch gate/i })).toBeVisible();
  await button(page, '▶ Start block').click();
  await advance(page, 10_500);
  const view = page.getByTestId('vpull-windows');
  await expect(view).toContainText('V-pulls · Right foot');
  await advance(page, 6_500);
  await expect(view).toContainText('Count your V-pulls.');
  await advance(page, 30_500);
  await expect(view).toContainText('V-pulls · Left foot');
  await advance(page, 37_000);
  await expect(view).toHaveCount(0);
  await expect(page.getByRole('button', { name: /DONE/ })).toBeVisible(); // the gate test, in the normal block view
  await button(page, 'DONE').click();
  await expect(page.locator('.count', { hasText: /V-pulls right/i }).first()).toBeVisible();
  const recs = await table<{ blocks: { windows?: { label: string; startMs: number; endMs: number }[] }[] }>(page, 'sessionRecords');
  const w = recs.flatMap((r) => r.blocks).find((b) => b.windows)?.windows;
  expect(w?.map((x) => x.label)).toEqual(['Right foot', 'Left foot']);
  expect(w![0].endMs - w![0].startMs).toBeGreaterThanOrEqual(29_000);
  expect(w![1].startMs).toBeGreaterThan(w![0].endMs);
});
