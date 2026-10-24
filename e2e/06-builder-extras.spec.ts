import { expect, test, type Page } from '@playwright/test';
import { advance, boot, button, fillForm, home, openFocus, patchSettings, place, runToEnd, setup, startCard, table } from './helpers';

async function ready(page: Page) {
  await boot(page);
  await setup(page);
  await patchSettings(page, { cueEngine: false });
}

test('builder: durations, area limits, totals, light; a 45-minute two-area session counts both areas', async ({ page }) => {
  await ready(page);
  await place(page, 'Dribbling', 5);
  await place(page, 'Ball control', 6);
  await openFocus(page);
  await button(page, 'Build a longer session').click();
  // 30 minutes: one area.
  await button(page, '30 min').click();
  await button(page, 'Dribbling S5').click();
  await button(page, 'Ball control S6').click(); // ignored: only one area for 30 min
  await expect(page.getByRole('heading', { name: '30 min · Dribbling S5' })).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Total' })).toContainText('30 min');
  // 45 minutes: two areas; one area has no template.
  await button(page, '45 min').click();
  await expect(page.getByText(/No 45-minute template for 1 area\./)).toBeVisible();
  await button(page, 'Ball control S6').click();
  await expect(page.getByRole('heading', { name: '45 min · Dribbling S5 + Ball control S6' })).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Total' })).toContainText('45 min');
  await expect(page.locator('table.data tr')).toHaveCount(14);
  // Light: no benchmark, same total.
  await button(page, 'Light (no benchmark, longer rest)').click();
  await expect(page.getByRole('heading', { name: '45 min · light · Dribbling S5 + Ball control S6' })).toBeVisible();
  await expect(page.locator('table.data')).not.toContainText('benchmark');
  await button(page, 'Normal').click();
  // 60 minutes allows three areas.
  await button(page, '60 min').click();
  await expect(page.getByText('Areas (up to 3)')).toBeVisible();
  await button(page, '45 min').click();
  await button(page, 'Ball control S6').click();
  await button(page, 'Ball control S6').click();
  await button(page, 'Continue').click();
  // Start screen: block list, total, trial toggle.
  await expect(page.getByRole('heading', { name: '45 min · Dribbling S5 + Ball control S6' })).toBeVisible();
  const box = page.getByRole('checkbox');
  if (await box.isChecked()) await box.uncheck();
  await button(page, 'Start').click();
  await runToEnd(page, { maxMinutes: 80 });
  await expect(page.locator('.card', { hasText: 'Dribbling · Session 5' })).toContainText('completed');
  await expect(page.locator('.card', { hasText: 'Ball control · Session 6' })).toContainText('completed');
  await home(page);
  await expect(page.getByText('2 of 3 planned done')).toBeVisible();
  await expect(startCard(page, 'Dribbling · Stage 2 · Session 6')).toBeVisible();
  await expect(startCard(page, 'Ball control · Stage 2 · Session 7')).toBeVisible();
  const recs = await table<{ runId: string; plannedMinutes: number }>(page, 'sessionRecords');
  expect(recs).toHaveLength(2);
  expect(recs[0].runId).toBe(recs[1].runId);
  await button(page, 'Progress').click();
  await expect(page.getByText('Planned 3 · Completed 2 · Minutes 45')).toBeVisible();
});

test('light 20-minute session: no benchmark, counts as completed', async ({ page }) => {
  await ready(page);
  await place(page, 'Feinting', 7);
  await openFocus(page);
  await button(page, 'Build a longer session').click();
  await button(page, '20 min').click();
  await button(page, 'Feinting S7').click();
  await button(page, 'Light (no benchmark, longer rest)').click();
  await expect(page.locator('table.data')).toContainText('mobility');
  await expect(page.locator('table.data')).not.toContainText('benchmark');
  await button(page, 'Continue').click();
  await page.getByRole('checkbox').uncheck();
  await button(page, 'Start').click();
  await runToEnd(page);
  await expect(page.locator('.card', { hasText: 'Feinting · Session 7' })).toContainText('Feinting Session 7 complete');
  expect(await table(page, 'benchmarkResults')).toHaveLength(0);
});

/** Answers the picture on screen correctly: the touch goes away from the defenders. */
async function answer(page: Page) {
  const lines = await page.locator('.quiz-pitch line').evaluateAll((ls) => ls.map((l) => Number(l.getAttribute('x1'))));
  const left = lines.includes(92) || lines.includes(128);
  const right = lines.includes(272) || lines.includes(308);
  await button(page, left && right ? 'BACK' : left ? 'RIGHT' : 'LEFT').click();
}

test('no-ball picture quiz: an extra with its score; never unlocks', async ({ page }) => {
  await ready(page);
  await place(page, 'Scanning', 1);
  await openFocus(page);
  await button(page, 'No-ball picture quiz').click();
  await expect(page.getByRole('heading', { name: 'No-ball picture quiz' })).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Total' })).toContainText('10 min');
  await page.getByRole('checkbox').uncheck();
  await button(page, 'Start').click();
  await expect(page.getByText('Picture quiz', { exact: false }).first()).toBeVisible();
  await button(page, '▶ Start block').click();
  await advance(page, 10_500);
  await expect(page.getByText(/Picture 1 of 20/)).toBeVisible();
  for (let i = 0; i < 15; i++) await answer(page); // 15 right, then let 5 time out
  await expect(page.getByText(/Picture 16 of 20/)).toBeVisible();
  await page.clock.runFor(2_500 * 5);
  await runToEnd(page);
  const card = page.locator('.card', { hasText: 'Extra' });
  await expect(card).toContainText('saved as an extra');
  await expect(card).toContainText('Picture quiz: 15/20. No earlier result at the same conditions.');
  await home(page);
  await expect(startCard(page, 'Scanning · Stage 1 · Session 1')).toBeVisible();
  await expect(page.getByText('0 of 3 planned done')).toBeVisible();
});

test('anchor check: four fixed-condition anchors, never unlocks, not due afterwards', async ({ page }) => {
  await ready(page);
  await place(page, 'Dribbling', 1);
  await openFocus(page);
  await expect(button(page, 'Anchor check · due')).toBeVisible();
  await openFocus(page);
  await button(page, 'Anchor check · due').click();
  await expect(page.locator('tr', { hasText: 'Total' })).toContainText('12 min');
  for (const a of ['A1 Slalom down and back', 'A2 Outside-touch gate test', 'A3 Arrow-exit lane', 'A4 Cue-behind decision test']) await expect(page.locator('table.data')).toContainText(a);
  await page.getByRole('checkbox').uncheck();
  await button(page, 'Start').click();
  const seen: string[] = [];
  await runToEnd(page, {
    onForm: async (p) => {
      const pill = await p.locator('.pill.info').innerText();
      seen.push(`${await p.locator('h2').first().innerText()} | ${pill}`);
      await (await fillForm(p)).click();
    },
  });
  expect(seen).toEqual([
    'Slalom down and back | anchor layout (fixed) · level std',
    'Outside-touch gate test | anchor layout (fixed) · level std',
    'Arrow-exit lane | anchor layout (fixed) · level manual-switchedon',
    'Cue-behind decision test | anchor layout (fixed) · level manual-switchedon',
  ]);
  await expect(page.locator('.card', { hasText: 'Anchor check' })).toContainText('Anchor check saved. It does not unlock sessions or count toward the week.');
  await home(page);
  await openFocus(page);
  await expect(button(page, 'Anchor check')).toHaveText('Anchor check');
  await expect(page.getByText('0 of 3 planned done')).toBeVisible();
  const results = await table<{ benchmarkId: string; conditions: { layoutVersion: number } }>(page, 'benchmarkResults');
  expect(results.map((r) => r.benchmarkId).sort()).toEqual(['A1', 'A2', 'A3', 'A4']);
  expect(results.every((r) => r.conditions.layoutVersion === 0)).toBe(true);
  await button(page, 'Progress').click();
  await expect(page.getByText(/Anchors: A1 Pattern R/)).toBeVisible();
});
