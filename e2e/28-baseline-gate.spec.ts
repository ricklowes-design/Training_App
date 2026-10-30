import { expect, test, type Page } from '@playwright/test';
import { boot, button, openParent, PIN, setup } from './helpers';

// Audit 2026-10-29 task 1: the baseline's placement answers are behind the parent PIN, and
// parent mode locks again when the route leaves parent screens.

/** A finished dribbling baseline that has no placement yet, as if the player tapped Back at the PIN. */
async function seedFinishedBaseline(page: Page, areaId = 'dribbling') {
  await page.evaluate(
    (areaId) =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open('home-training');
        r.onsuccess = () => {
          const tx = r.result.transaction('sessionRecords', 'readwrite');
          const now = new Date().toISOString();
          tx.objectStore('sessionRecords').put({ id: 'bl-1', runId: 'run-bl', kind: 'baseline', areaId, date: now, endedAt: now, status: 'completed', reasons: [], plannedMinutes: 12, blocks: [], pauses: [], trial: false, light: false, partner: false });
          tx.oncomplete = () => resolve();
        };
      }),
    areaId,
  );
  await page.reload();
}

test('a waiting baseline shows on Home; its questions need the PIN; parent mode locks again after', async ({ page }) => {
  await boot(page, { clock: false });
  await setup(page, { focus: false });
  await seedFinishedBaseline(page);
  await openParent(page, /^Placement/);
  await page.getByRole('button', { name: 'Answer the baseline questions' }).first().click();
  // Inside parent mode: no second PIN.
  await expect(page.getByRole('heading', { name: 'Dribbling baseline · parent questions' })).toBeVisible();
  await expect(page.getByLabel('PIN', { exact: true })).toHaveCount(0);
  for (const b of await page.getByRole('button', { name: 'Yes', exact: true }).all()) await b.click();
  await button(page, 'Confirm placement').click();
  await expect(page.getByRole('heading', { level: 1, name: /· Week of/ })).toBeVisible();
  // Leaving parent screens locked parent mode.
  await button(page, 'Parent mode').click();
  await expect(page.getByLabel('PIN', { exact: true })).toBeVisible();
});

test('the Home card for a waiting baseline goes to the PIN, then the questions', async ({ page }) => {
  await boot(page, { clock: false });
  await setup(page, { focus: false });
  // Scanning is the first suggestion after set-up.
  await seedFinishedBaseline(page, 'scanning');
  const waiting = page.getByTestId('baseline-waiting');
  await expect(waiting).toContainText('Baseline done. A parent answers a few questions');
  await waiting.getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Parent mode' })).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill(PIN);
  await button(page, 'Open').click();
  await expect(page.getByRole('heading', { name: 'Scanning baseline · parent questions' })).toBeVisible();
});
