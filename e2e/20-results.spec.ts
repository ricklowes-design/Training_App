import { expect, test } from '@playwright/test';
import { boot, button, openParent, setup, table } from './helpers';

// Parent → Benchmark results: mark a result unreliable, and clear it again.

test('a parent marks a benchmark result unreliable with a reason, and can clear it', async ({ page }) => {
  await boot(page, { clock: false });
  await setup(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open('home-training');
        r.onsuccess = () => {
          const tx = r.result.transaction('benchmarkResults', 'readwrite');
          tx.objectStore('benchmarkResults').put({
            id: 'res-1',
            sessionRecordId: 'r',
            blockIndex: 4,
            attempt: 1,
            benchmarkId: 'SB',
            date: '2026-11-04T18:00:00.000Z',
            values: { kind: 'SB', correct: 7 },
            conditions: { layoutVersion: 1, cueLevel: '3', floor: 'hard', recorded: false, recordedBy: 'parent' },
          });
          tx.oncomplete = () => resolve();
        };
      }),
  );
  await page.reload();
  await openParent(page, /^Benchmark results/);
  const row = page.getByTestId('result-res-1');
  await expect(row).toContainText('Decisions 7/10');
  await row.getByLabel('Reason for res-1').selectOption('timed by hand');
  await button(row, 'Mark unreliable').click();
  await expect(row).toContainText('unreliable: timed by hand');
  expect((await table<{ id: string; flagged?: string }>(page, 'benchmarkResults')).find((x) => x.id === 'res-1')!.flagged).toBe('timed by hand');
  await button(row, 'Clear unreliable').click();
  await expect(row).not.toContainText('unreliable:');
  expect((await table<{ id: string; flagged?: string }>(page, 'benchmarkResults')).find((x) => x.id === 'res-1')!.flagged).toBeUndefined();
});
