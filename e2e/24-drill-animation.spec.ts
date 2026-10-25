import { expect, test } from '@playwright/test';
import { boot, openParent, setup } from './helpers';

// Animated demonstrations of the app's own combination drills (no outside video shows them).

test('the combination drills show an animated drill with each cue outcome', async ({ page }) => {
  await boot(page, { clock: false });
  await setup(page);
  await openParent(page, /^Demonstrations/);
  const card = page.getByTestId('demo-F4');
  await card.locator('summary').click();
  const anim = card.getByTestId('drill-animation-F4');
  await expect(anim).toContainText('The drill: If the screen says GO');
  await expect(anim.locator('svg')).toBeVisible();
  // The cue appears on the screen, then the decision follows.
  await expect(anim.locator('svg')).toContainText('GO', { timeout: 8000 });
  await expect(anim.locator('.note-box')).toContainText(/GO: exit at once|Into the stop zone/, { timeout: 8000 });
  await anim.getByRole('button', { name: 'HELD' }).click();
  await expect(anim).toContainText('The drill: If the screen says HELD');
  await expect(anim.locator('.note-box')).toContainText(/HELD: body feint the other way|then exit right|Into the stop zone/, { timeout: 9000 });
  await anim.getByRole('button', { name: 'Pause' }).click();
  await expect(anim.getByRole('button', { name: 'Play' })).toBeVisible();
  // Drills that have a full outside demonstration get no animation.
  await expect(page.getByTestId('demo-F1').locator('summary')).toHaveCount(0);
});
