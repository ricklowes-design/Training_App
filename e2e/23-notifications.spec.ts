import { expect, test } from '@playwright/test';
import { boot, button, closeParent, openParent, patchSettings, place, runToEnd, setup, start } from './helpers';

// Completion messages to a chat webhook (plan/14). Discord is stood in for: nothing leaves the test.

const FLAGS = { defender3d: false, realisticDefender: false, rapidTouches: false, liveOnsetDetector: false, speechDiagnostic: false, notifications: true, ballTracking: false, learning: false, coneDetection: false, neuralBallDetector: false };
const HOOK = 'https://discord.com/api/webhooks/123456/abcDEF-ghi';

test('set up a Discord webhook, send a test, and a completed session posts one short message', async ({ page }) => {
  test.setTimeout(240_000);
  const posted: string[] = [];
  await page.route('https://discord.com/api/webhooks/**', async (route) => {
    const body = route.request().postData() ?? '';
    posted.push(body);
    await route.fulfill({ status: 204, body: '', headers: { 'access-control-allow-origin': '*' } });
  });
  await boot(page);
  await setup(page);
  await patchSettings(page, { flags: FLAGS });
  await page.reload();
  await openParent(page, /^Settings/);
  const card = page.getByTestId('notifications-card');
  await expect(button(card, 'Send a test message')).toBeDisabled();
  await card.locator('#notify-webhook').fill(HOOK);
  await button(card, 'Send a test message').click();
  await expect(card.getByText('Sent. Check the chat.')).toBeVisible();
  expect(posted[0]).toContain('Test message from the home training app.');
  await closeParent(page);
  await place(page, 'Dribbling', 1);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await runToEnd(page);
  await expect(page.getByRole('heading', { name: 'Session saved' })).toBeVisible();
  await expect.poll(() => posted.length).toBe(2);
  expect(posted[1]).toContain('Dribbling Session 1 complete: all 4 blocks, 20 minutes.');
  // Only the session line: no results, notes or names.
  expect(posted[1]).not.toMatch(/err|time|note/i);
});
