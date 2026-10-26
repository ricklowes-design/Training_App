import { expect, test } from '@playwright/test';
import { advance, boot, button, openParent, place, setup, start, table } from './helpers';

// Measured once at set-up; the cones are shown when each drill starts, against the room's fixed points.

test('a drill starts with its cone set-up, placed against the measured fixed points', async ({ page }) => {
  await boot(page);
  await setup(page);
  // Add a fixed point to the room (as the parent would in the set-up's room step), then reload.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open('home-training');
        r.onsuccess = () => {
          const tx = r.result.transaction('roomProfiles', 'readwrite');
          const st = tx.objectStore('roomProfiles');
          const g = st.get('room-1');
          g.onsuccess = () => st.put({ ...g.result, landmarks: [{ id: 'door', label: 'Door frame', side: 'right', alongM: 1.8 }] });
          tx.oncomplete = () => resolve();
        };
      }),
  );
  await page.reload();
  await place(page, 'Dribbling', 1);
  await start(page, 'Dribbling · Stage 1 · Session 1');
  // Warm-up (no cones), then the slalom's demo view: cones first, with a longer wait before it starts.
  await advance(page, 10_000 + 180_000 + 1_000);
  const cones = page.getByTestId('cone-setup');
  await expect(cones).toContainText('Set out the cones');
  await expect(cones.locator('.cone-list li').first()).toHaveText('Slalom cone 1: 0.8 m from the back wall, on the centre line');
  await expect(cones.locator('.cone-list li').nth(1)).toHaveText('Slalom cone 2: 1.8 m from the back wall, on the centre line, level with the door frame (right)');
  await expect(cones.getByTestId('landmark')).toContainText('Door frame');
  await expect(page.getByText(/Starts by itself in (5\d|60) s/)).toBeVisible();
  await advance(page, 25_000);
  await expect(button(page, '▶ Start block')).toBeVisible(); // still waiting after the usual 20 s
});

test('home asks for the ball check once; "Not now" puts it away', async ({ page }) => {
  await boot(page);
  await setup(page);
  const prompt = page.getByTestId('ball-check-prompt');
  await expect(prompt).toContainText('Before the first drills');
  await button(prompt, 'Not now').click();
  await expect(prompt).toHaveCount(0);
  const [s] = await table<{ ballCheck: { skipped: boolean } }>(page, 'settings');
  expect(s.ballCheck.skipped).toBe(true);
  // Parent → Balls still opens on the check until it has been done.
  await openParent(page, /^Balls/);
  await expect(page.getByTestId('ball-check')).toContainText('Which ball works best?');
});
