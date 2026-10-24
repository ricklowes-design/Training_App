import { expect, test, type Locator, type Page } from '@playwright/test';
import { advance, boot, button, closeParent, fillForm, home, openParent, patchSettings, place, runToEnd, setup, slalom, start, startCard, table } from './helpers';

type Result = { benchmarkId: string; conditions: { layoutVersion: number; cueLevel: string; timing?: string }; values: Record<string, unknown> };

async function stepTo(scope: Locator, label: string, target: number) {
  // A time the run's timer did not capture starts blank: enter it first.
  const enter = scope.getByRole('button', { name: `${label} start` });
  if (await enter.count()) await enter.click();
  const val = scope.locator('.stepper', { hasText: label }).locator('.val');
  for (let i = 0; i < 40; i++) {
    const v = Number((await val.innerText()).split(' ')[0]);
    if (Math.abs(v - target) < 1e-6) return;
    await scope.locator('.stepper', { hasText: label }).getByRole('button', { name: `${label} ${v < target ? 'up' : 'down'}` }).click();
  }
  throw new Error(`could not set ${label}`);
}

/** One tap on a number in a result card. */
async function pick(scope: Locator | Page, label: string, n: number) {
  await scope.getByRole('button', { name: `${label} ${n}`, exact: true }).click();
}

async function ready(page: Page) {
  await boot(page);
  await setup(page);
  await patchSettings(page, { cueEngine: false }); // cue engine has its own spec; keeps these runs fast
}

test('baseline: slalom timed by the app, parent questions, proposal and override', async ({ page }) => {
  await ready(page);
  // Dribbling is not placed: its baseline is offered.
  await start(page, 'Dribbling · Baseline');
  await advance(page, 10_000 + 180_000 + 1_000); // warm-up
  await expect(page.getByRole('heading', { name: /Benchmark · Slalom time and control/i })).toBeVisible();
  await button(page, '▶ Start block').click();
  await page.clock.runFor(10_500);
  await slalom(page, 9.8, 11.2);
  // The form has this run's measured times (an estimate from the current block); errors start blank.
  const form = page.locator('.card', { hasText: 'Slalom time and control' });
  await expect(form.getByText('layout v1 · level std')).toBeVisible();
  // Times come from the start tone and the tap (within the fake clock's scheduling slack).
  const tR = Number(await form.locator('.stepper', { hasText: 'Pattern R time (s)' }).locator('.val').innerText());
  const tL = Number(await form.locator('.stepper', { hasText: 'Pattern L time (s)' }).locator('.val').innerText());
  expect(Math.abs(tR - 9.8)).toBeLessThan(1);
  expect(Math.abs(tL - 11.2)).toBeLessThan(1);
  await expect(form.locator('.count[data-blank]')).toHaveCount(2);
  await expect(button(page, 'Confirm')).toBeDisabled();
  await stepTo(form, 'Pattern R time (s)', 9.8);
  await stepTo(form, 'Pattern L time (s)', 11.2);
  await pick(form, 'Pattern R control errors', 2);
  await pick(form, 'Pattern L control errors', 1);
  await button(page, 'Confirm').click();
  await expect(page.locator('.endcard .now')).toHaveText('Pattern R 9.8 s · 2 err · Pattern L 11.2 s · 1 err');
  await runToEnd(page);
  // Parent questions.
  await expect(page.getByRole('heading', { name: 'Dribbling baseline · parent questions' })).toBeVisible();
  await expect(page.getByText('DB: Pattern R 9.8 s · 2 err · Pattern L 11.2 s · 1 err')).toBeVisible();
  await expect(button(page, 'Confirm placement')).toBeDisabled();
  for (const b of await page.getByRole('button', { name: 'Yes', exact: true }).all()) await b.click();
  await expect(page.getByText(/Proposed: Stage 2 Session 5 because 3 of 3 answers were yes/)).toBeVisible();
  await page.getByLabel(/Start at session/).selectOption('3');
  await button(page, 'Confirm placement').click();
  await home(page);
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 3')).toBeVisible();
  const [pl] = await table<{ startSession: number; proposed: number; overridden: boolean }>(page, 'placements');
  expect(pl).toMatchObject({ startSession: 3, proposed: 5, overridden: true });
  const history = await table<{ action: string; detail: string }>(page, 'history');
  expect(history.some((h) => h.action === 'placement' && /override; proposed 5/.test(h.detail))).toBe(true);
});

test('baseline: "Later" leaves the area unplaced; Parent → Placement answers the questions afterwards', async ({ page }) => {
  await ready(page);
  await start(page, 'Dribbling · Baseline');
  await runToEnd(page, { onForm: (p) => button(p, 'Skip benchmark').click() });
  await button(page, 'Later').click();
  await expect(startCard(page, 'Dribbling · Baseline')).toBeVisible();
  await openParent(page, /^Placement/);
  await button(page, 'Answer the baseline questions').click();
  for (const b of await page.getByRole('button', { name: 'No', exact: true }).all()) await b.click();
  await expect(page.getByText(/Proposed: Stage 1 Session 1 because 0 of 3/)).toBeVisible();
  await button(page, 'Confirm placement').click();
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 1')).toBeVisible();
});

test('slalom benchmark: faster with more errors is never called an improvement; time always with errors', async ({ page }) => {
  await ready(page);
  await place(page, 'Dribbling', 3);
  for (const [n, r, l, errs] of [
    [3, 9.8, 11.2, 1],
    [4, 9.6, 11.0, 2],
  ] as const) {
    await start(page, `Dribbling · Stage 1 · Session ${n}`);
    await runToEnd(page, {
      onTimed: (p) => slalom(p, r, l),
      onForm: async (p) => {
        const form = p.locator('.card', { hasText: 'Slalom time and control' });
        // Never pre-filled from the earlier session (part 15 D10): the errors are blank again.
        await expect(form.locator('.count[data-blank]')).toHaveCount(2);
        await stepTo(form, 'Pattern R time (s)', r);
        await stepTo(form, 'Pattern L time (s)', l);
        await pick(form, 'Pattern R control errors', errs);
        await pick(form, 'Pattern L control errors', 1);
        await button(p, 'Confirm').click();
      },
    });
    if (n === 4) {
      // End-of-drill card and summary: "faster, more errors", never "up from".
      const card = page.locator('.card', { hasText: 'Dribbling · Session 4' });
      await expect(card).toContainText('Slalom time and control Pattern R: 9.6 s with 2 errors, previously 9.8 s with 1: faster, 1 more error(s).');
    }
    await home(page);
  }
  const results = await table<Result>(page, 'benchmarkResults');
  expect(results).toHaveLength(2);
  // Compare in the drill view: the second result is faster on R with one more error.
  await button(page, 'Progress').click();
  await button(page, 'Drills').click();
  await page.locator('li', { hasText: 'DB · Slalom time and control' }).getByRole('button').click();
  await expect(page.getByText(/^Now \(Nov 3\):/)).toBeVisible();
  const text = await page.locator('.card').first().innerText();
  expect(text).toMatch(/s · \d+ err/);
  expect(text).not.toMatch(/Pattern R: .* up from/);
  expect(text).toMatch(/Slalom time and control Pattern R: .* with 2 errors, previously .* with 1: faster, 1 more error\(s\)\./);
});

test('a room change starts a new layout line: no comparison across layouts, with the reason', async ({ page }) => {
  await ready(page);
  await place(page, 'Ball control', 3);
  await start(page, 'Ball control · Stage 1 · Session 3');
  await runToEnd(page);
  await home(page);
  const first = await table<Result>(page, 'benchmarkResults');
  expect(first[0]).toMatchObject({ benchmarkId: 'CB', conditions: { layoutVersion: 1, cueLevel: 'std' } });
  // Change the room: layout v2.
  await openParent(page, /^Room profiles/);
  await page.locator('li', { hasText: 'Main room' }).getByRole('button', { name: 'Edit' }).click();
  await button(page, 'I know it roughly').click();
  await page.getByLabel('Clear floor length (m, approximate)').fill('5.0');
  await button(page, 'Save and close').click();
  await expect(page.locator('li', { hasText: /^v2 ·/ })).toBeVisible();
  await closeParent(page);
  await start(page, 'Ball control · Stage 1 · Session 4');
  await runToEnd(page);
  const card = page.locator('.card', { hasText: 'Ball control · Session 4' });
  await expect(card).toContainText('No earlier result at the same conditions.');
  await expect(card).not.toContainText('up from');
  await home(page);
  await button(page, 'Progress').click();
  await button(page, 'Drills').click();
  await page.locator('li', { hasText: 'CB · V-pulls and outside-touch gate' }).getByRole('button').click();
  await expect(page.getByText('Not compared: different room layout (v1 then, v2 now).')).toBeVisible();
  await expect(page.locator('tr.greyed')).toContainText('not compared: different room layout');
});

test('feint rubric form saves per side, level and scorer', async ({ page }) => {
  await ready(page);
  await place(page, 'Feinting', 3);
  await start(page, 'Feinting · Stage 1 · Session 3');
  await runToEnd(page, {
    onForm: async (p) => {
      const form = p.locator('.card', { hasText: 'Feint rubric' });
      await expect(form.getByText('layout v1 · level walk')).toBeVisible();
      await pick(form, 'Left fake /10', 3);
      await button(form, 'Player').click();
      await (await fillForm(p)).click();
    },
  });
  const [fb] = await table<Result>(page, 'benchmarkResults');
  expect(fb).toMatchObject({ benchmarkId: 'FB', conditions: { cueLevel: 'walk', recordedBy: 'self' }, values: { kind: 'FB', left: { sell: 3, exit: 5, eyes: 5 } } });
  await expect(page.locator('.card', { hasText: 'Feinting · Session 3' })).toContainText('Feint rubric Right exits: 15/30 (fake 5, exit 5, eyes 5). No earlier result at the same conditions.');
});

test('skipping the benchmark gives "completed, benchmark skipped" and still unlocks', async ({ page }) => {
  await ready(page);
  await place(page, 'Ball control', 3);
  await start(page, 'Ball control · Stage 1 · Session 3');
  await runToEnd(page, { onForm: async (p) => button(p, 'Skip benchmark').click() });
  const card = page.locator('.card', { hasText: 'Ball control · Session 3' });
  await expect(card).toContainText('completed, benchmark skipped');
  await expect(card).toContainText('Session complete with the benchmark skipped. Session 4 is unlocked.');
  await home(page);
  await expect(startCard(page, 'Ball control · Stage 1 · Session 4')).toBeVisible();
});
