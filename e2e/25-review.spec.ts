import { expect, test } from '@playwright/test';
import { boot, button, setup } from './helpers';

// Progress → Review: the month in numbers and one chart per test, joined at the same conditions only.

const cond = (layoutVersion: number) => ({ layoutVersion, cueLevel: 'std', floor: 'hard', recorded: false, recordedBy: 'parent' });
const slalom = (id: string, date: string, rt: number, re: number, layoutVersion = 1, flagged?: string) => ({
  id,
  sessionRecordId: 'rec-1',
  blockIndex: 4,
  attempt: 1,
  benchmarkId: 'DB',
  date,
  values: { kind: 'DB', right: { timeS: rt, errors: re }, left: { timeS: 10.5, errors: 1 } },
  conditions: cond(layoutVersion),
  ...(flagged ? { flagged } : {}),
});

test('the Review tab summarises the month and charts the slalom with its errors, at the same conditions only', async ({ page }) => {
  await boot(page);
  await setup(page);
  await page.evaluate(
    (rows) =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open('home-training');
        r.onsuccess = () => {
          const tx = r.result.transaction(['sessionRecords', 'benchmarkResults'], 'readwrite');
          tx.objectStore('sessionRecords').put({
            id: 'rec-1', runId: 'run-1', kind: 'programme', areaId: 'dribbling', sessionNumber: 4, date: '2026-11-02T18:00:00.000Z',
            status: 'completed', reasons: [], plannedMinutes: 20, blocks: [], pauses: [], trial: false, appVersion: 'x', contentVersion: 'x', layoutVersion: 1,
          });
          for (const x of rows) tx.objectStore('benchmarkResults').put(x);
          tx.oncomplete = () => resolve();
        };
      }),
    [
      slalom('old-layout', '2026-09-20T18:00:00.000Z', 12, 0, 2),
      slalom('oct', '2026-10-20T18:00:00.000Z', 9.8, 1),
      slalom('flagged', '2026-10-27T18:00:00.000Z', 7.0, 0, 1, 'start tone missed'),
      slalom('nov', '2026-11-02T18:00:00.000Z', 9.4, 2),
    ],
  );
  await page.reload();
  await button(page, 'Progress').click();
  await button(page, 'Review').click();
  await expect(page.getByRole('heading', { name: /November 2026/ })).toBeVisible();
  const summary = page.getByTestId('month-review');
  await expect(summary).toContainText('1 of');
  await expect(summary).toContainText('Dribbling 1');
  await expect(summary).toContainText('DB R 9.4 s (errors 2), L 10.5 s (errors 1)');
  await expect(summary).toContainText('Clips marked for review0');

  const chart = page.getByTestId('trend-DB');
  await expect(chart.getByText('Time (s, lower is quicker)')).toBeVisible();
  await expect(chart.getByText('Errors', { exact: true })).toBeVisible();
  await expect(chart).toContainText('Unreliable (not drawn): ');
  await expect(chart).toContainText('start tone missed');
  await expect(chart).toContainText('Not joined: 1 earlier result at other conditions (different room layout');
  await expect(chart).toContainText('2 results at these conditions');
  // Two results, two series per panel: two time panels points + two error panel points per foot.
  await expect(chart.locator('svg').first().locator('circle')).toHaveCount(4);
  await chart.locator('svg').first().locator('rect[fill="transparent"]').last().dispatchEvent('pointerdown');
  await expect(chart.getByTestId('trend-tip')).toContainText('Pattern R 9.4 s · 2 err · Pattern L 10.5 s · 1 err');

  // Earlier month: October has the result before; the export button is there.
  await button(page, 'Previous month').click();
  await expect(page.getByRole('heading', { name: /October 2026/ })).toBeVisible();
  await expect(button(page, 'Export summary (text)')).toBeVisible();

  // The drill view carries the same chart.
  await button(page, 'Drills').click();
  await page.locator('li', { hasText: 'DB ·' }).getByRole('button').click();
  await expect(page.getByTestId('trend-chart')).toBeVisible();
});
