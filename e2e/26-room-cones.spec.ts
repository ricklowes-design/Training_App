import { expect, test } from '@playwright/test';
import { advance, boot, button, closeParent, openParent, place, setup, start, table } from './helpers';

// Measured once at set-up; the cones are shown when each drill starts, against the room's fixed points.

test('a drill starts with its cone set-up, placed against the measured fixed points', async ({ page }) => {
  await boot(page);
  await setup(page);
  // Measure from a door frame on the right wall (as in the set-up's "now measure these"), then reload.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open('home-training');
        r.onsuccess = () => {
          const tx = r.result.transaction('roomProfiles', 'readwrite');
          const st = tx.objectStore('roomProfiles');
          const g = st.get('room-1');
          g.onsuccess = () =>
            st.put({ ...g.result, space: { ...g.result.space, items: [{ id: 'door', label: 'Door frame', place: 'right', a: 1.8, b: g.result.space.widthM, source: 'typed' }] } });
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
  await expect(cones.locator('.cone-list li').first()).toHaveText('Slalom cone 1: 0.8 m from the back wall, in the middle, 1.5 m from each side wall');
  await expect(cones.locator('.cone-list li').nth(1)).toHaveText('Slalom cone 2: 1.8 m from the back wall, in the middle, 1.5 m from each side wall, level with the door frame (right)');
  await expect(cones.getByTestId('landmark')).toContainText('door frame');
  await expect(cones.getByTestId('start-position')).toContainText('Start (yellow circle): Stand behind the first cone');
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

test('a second, very narrow room: drills become single-cone versions, and home switches between rooms', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, { clock: false });
  await setup(page);
  await openParent(page, /^Room profiles/);
  await button(page, 'New room (guided measurement)').click();
  await page.getByLabel('Room name').fill('Hallway');
  await page.getByLabel('Room length metres').fill('5');
  await page.getByLabel('Room width metres').fill('1.3');
  await button(page, 'Next: take a photo of the space').click();
  await button(page, 'Skip the photo').click();
  await button(page, 'Next: your training space').click();
  // Nothing is refused at 1.3 m: the feint lane and the receiving drills change shape instead.
  await expect(page.getByTestId('training-space')).toContainText('Training space: 1.3 m wide × 5 m long');
  await expect(page.getByTestId('training-space')).not.toContainText('Feint lane (');
  await button(page, 'Save and use this room').click();
  const hall = page.locator('li', { hasText: 'Hallway' }).first();
  await expect(hall).toContainText('in use');
  await hall.getByRole('button', { name: 'Edit' }).click();
  await page.getByText(/^Drill layouts in this space/).click();
  await expect(page.getByText(/one exit cone at .* exit past it on the left or the right \(single-cone version, no gates\)/)).toBeVisible();
  await expect(page.getByText(/^two cones 0\.9 m apart in a line mid-room/)).toBeVisible();
  await button(page, 'Cancel').click();
  // The animated feint drill follows the room: past the exit cone, not through a gate.
  await closeParent(page);
  await openParent(page, /^Demonstrations/);
  const card = page.getByTestId('demo-F4');
  await card.locator('summary').click();
  await expect(card.getByTestId('drill-animation-F4').locator('.note-box')).toContainText(/past the exit cone|Into the stop zone|Body feint|Run at the feint cone|GO/, { timeout: 10_000 });
  // Home: choose the room before training; each keeps its own layout version.
  await page.goto('/');
  const choice = page.getByTestId('room-choice');
  await expect(choice.getByLabel('Training room')).toHaveValue(/room-/);
  await choice.getByLabel('Training room').selectOption({ label: 'Main room' });
  await expect(choice).toContainText('layout v1');
  await choice.getByLabel('Training room').selectOption({ label: 'Hallway' });
  await expect(choice).toContainText('layout v2');
});
