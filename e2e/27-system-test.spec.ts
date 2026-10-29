import { expect, test } from '@playwright/test';
import { boot, button, openParent, setup, table } from './helpers';

test('parent system test: lists the drills by cone layout, switches everything on, runs, reports, and puts the settings back', async ({ page }) => {
  await boot(page, { clock: false });
  await setup(page);
  await openParent(page, /^System test/);
  const intro = page.getByTestId('system-test');
  // Grouped by layout: the cones are set up four times, moved three.
  await expect(intro).toContainText('The cones are set up 4 times (3 moves)');
  await expect(intro).toContainText('Feint lane cones');
  await expect(page.getByTestId('system-test-ready')).toContainText('A ball registered for ball tracking');

  const before = (await table<{ flags: Record<string, boolean>; camera: { enabled: boolean } }>(page, 'settings'))[0];
  expect(before.camera.enabled).toBe(false);
  await page.getByTestId('system-test-start').click();
  // The runner starts on the first drill.
  await expect(page.locator('.practice, .demo, [data-testid="cones-step"]').first()).toBeVisible();
  const on = (await table<{ flags: Record<string, boolean>; camera: { enabled: boolean }; systemTestRestore?: unknown }>(page, 'settings'))[0];
  expect(on.camera.enabled).toBe(true);
  expect(on.flags.defender3d && on.flags.liveOnsetDetector && on.flags.ballTracking).toBe(true);
  expect(on.systemTestRestore).toBeTruthy();

  await button(page, 'STOP').click();
  // Straight to the report (never the session summary), every block listed.
  const report = page.getByTestId('system-test-report');
  await expect(report).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('system-test-block')).toHaveCount(8);
  await expect(page.getByTestId('system-test-totals')).toContainText('not run');
  const recs = await table<{ kind: string; trial: boolean }>(page, 'sessionRecords');
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ kind: 'systemTest', trial: true });

  // The parent's own checks are saved on the record.
  await page.getByTestId('system-test-parent-checks').locator('.row', { hasText: 'Did you hear the voice' }).getByRole('button', { name: 'Yes' }).click();
  await expect.poll(async () => (await table<{ parentChecks?: Record<string, boolean> }>(page, 'sessionRecords'))[0].parentChecks?.voice).toBe(true);

  await page.getByTestId('system-test-restore').click();
  await expect.poll(async () => (await table<{ camera: { enabled: boolean }; systemTestRestore?: unknown }>(page, 'settings'))[0].systemTestRestore).toBeUndefined();
  const after = (await table<{ flags: Record<string, boolean>; camera: { enabled: boolean } }>(page, 'settings'))[0];
  expect(after.camera.enabled).toBe(false);
  expect(after.flags).toEqual(before.flags);
});
