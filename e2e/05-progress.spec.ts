import { expect, test, type Page } from '@playwright/test';
import { advance, boot, button, closeParent, fillForm, home, openFocus, openParent, patchSettings, place, runToEnd, setup, start, startCard } from './helpers';

async function ready(page: Page) {
  await boot(page);
  await setup(page);
  await patchSettings(page, { cueEngine: false });
}

test('Week tab: an empty week is one line, with the previous week beneath', async ({ page }) => {
  await ready(page);
  await button(page, 'Progress').click();
  await expect(page.getByRole('heading', { name: 'Week of Nov 2, 2026' })).toBeVisible();
  await expect(page.getByText('No completed sessions this week.')).toBeVisible();
  await expect(page.getByText(/Previous week \(Oct 26\): none/)).toBeVisible();
  await expect(page.getByText('Last 8 weeks')).toHaveCount(0);
  await expect(page.getByText(/Planned 3/)).toHaveCount(0);
  await expect(button(page, '▶')).toBeDisabled(); // no future weeks
  await button(page, '◀').click();
  await expect(page.getByRole('heading', { name: 'Week of Oct 26, 2026' })).toBeVisible();
});

test('Week tab counts completed sessions only; partial, stopped, extras and trials are listed apart', async ({ page }) => {
  await ready(page);
  await place(page, 'Dribbling', 1);
  // Completed.
  await start(page, 'Dribbling · Stage 1 · Session 1');
  await runToEnd(page);
  await home(page);
  // Stopped.
  await start(page, 'Dribbling · Stage 1 · Session 2');
  await advance(page, 20_000);
  await button(page, 'STOP').click();
  await home(page);
  // A trial.
  await start(page, 'Dribbling · Stage 1 · Session 2', { trial: true });
  await advance(page, 20_000);
  await button(page, 'STOP').click();
  await home(page);
  // An extra: the no-ball quiz.
  await openFocus(page);
  await button(page, 'No-ball picture quiz').click();
  await expect(page.getByText('This is an extra: it does not unlock a session or count toward the week.')).toBeVisible();
  await page.getByRole('checkbox').uncheck();
  await button(page, 'Start').click();
  await runToEnd(page);
  await home(page);

  await button(page, 'Progress').click();
  await expect(page.getByText('Planned 3 · Completed 1 · Minutes 20')).toBeVisible();
  const drib = page.locator('li', { hasText: 'Dribbling' });
  await expect(drib).toContainText('S1 ✔ Tue');
  await expect(drib).toContainText('S2 ○ Tue (stopped — not counted)');
  await expect(page.getByText(/Not counted: Dribbling S2 stopped — not counted/)).toBeVisible();
  await expect(page.getByText(/Extras: picture quiz Tue \(\d+\/20\)/)).toBeVisible();
  await expect(page.getByText('Trials this week: 1 (not counted; see Parent → Trials)')).toBeVisible();
  await expect(page.getByText('Last 8 weeks (completed sessions)')).toBeVisible();
  await expect(page.locator('.bars .b').last()).toContainText('1');
});

test('Skills tab: stage, sessions, criteria progress, priority tag, coach note, and repeating a completed session as an extra', async ({ page }) => {
  await ready(page);
  await place(page, 'Ball control', 3);
  await openParent(page, /^Coach notes/);
  await button(page, 'Area').click();
  await page.locator('select').first().selectOption('control');
  await page.getByPlaceholder(/Smaller scissors/).fill('Open the hips on the left');
  await button(page, 'Save note').click();
  await closeParent(page);
  await start(page, 'Ball control · Stage 1 · Session 3');
  await runToEnd(page);
  await home(page);
  await button(page, 'Progress').click();
  await button(page, 'Skills').click();
  const control = page.locator('.card', { hasText: 'BALL CONTROL AND RECEIVING' });
  await expect(control).toContainText('Stage 1 · CONTROL · Session 4 of 16');
  await expect(control).toContainText('Completed: S3 · Next: S4 · Locked: S5–S16');
  await expect(control).toContainText('placed at S3');
  await expect(control).toContainText(/To reach Stage 2: CB-2 >= 7\/10 with left >= 3\/5 twice — 1 of 2 \(Nov 3: Gate test 10\/10/);
  await expect(control).toContainText('priority');
  await expect(control).toContainText('Coach note Nov 3: “Open the hips on the left”');
  await expect(page.locator('.card', { hasText: 'SCANNING AND DECISION-MAKING' })).toContainText('Baseline not done');
  // Repeat S3 as an extra.
  await button(control, 'S3').click();
  await expect(page.getByRole('heading', { name: 'Ball control · Session 3 (repeat)' })).toBeVisible();
  await expect(page.getByText('Total')).toBeVisible();
  await page.getByRole('checkbox').uncheck();
  await button(page, 'Start').click();
  await runToEnd(page);
  const card = page.locator('.card', { hasText: 'Ball control · Session 3' });
  await expect(card).toContainText('Ball control Session 3 saved as an extra. Extras do not unlock sessions or count toward the week.');
  await home(page);
  await expect(startCard(page, 'Ball control · Stage 1 · Session 4')).toBeVisible();
  await expect(page.getByText('1 of 3 planned done')).toBeVisible();
});

test('Drills tab and drill view: practice history and the comparison picker (last, 1 month, 3 months, a date)', async ({ page }) => {
  await ready(page);
  await place(page, 'Ball control', 3);
  // Three gate tests: today, ~5 weeks later, ~14 weeks later.
  const dates = ['2026-11-03T17:00:00', '2026-12-08T17:00:00', '2027-02-09T17:00:00'];
  for (let i = 0; i < dates.length; i++) {
    if (i > 0) await page.clock.setSystemTime(new Date(dates[i]));
    if (i > 0) await page.reload();
    const n = i === 0 ? 3 : 4;
    const title = i < 2 ? `Ball control · Stage 1 · Session ${n}` : 'Ball control · Session 4 (repeat)';
    if (i < 2) await start(page, title);
    else {
      await button(page, 'Progress').click();
      await button(page, 'Skills').click();
      await button(page.locator('.card', { hasText: 'BALL CONTROL' }), 'S4').click();
      await page.getByRole('checkbox').uncheck();
      await button(page, 'Start').click();
    }
    await runToEnd(page, {
      onForm: async (p) => {
        // Gate test right foot: 2, 3, 4 passes over time.
        await p.getByRole('button', { name: `Gate right /5 ${2 + i}`, exact: true }).click();
        await (await fillForm(p, 3)).click();
      },
    });
    await home(page);
  }
  await button(page, 'Progress').click();
  await button(page, 'Drills').click();
  await expect(page.locator('li', { hasText: 'D1 · Slalom close control' }).getByRole('button')).toHaveText('not done yet');
  await page.locator('li', { hasText: 'C1 · Mastery set' }).getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Practice blocks are counted, not compared.')).toBeVisible();
  await expect(page.locator('table.data tr')).toHaveCount(1); // C1 appears once, in Session 3
  await button(page, 'Back').click();
  await page.locator('li', { hasText: 'CB · V-pulls and outside-touch gate' }).getByRole('button').click();
  await expect(page.getByText(/^Now \(Feb 9\): Gate test 7\/10/)).toBeVisible();
  await expect(page.getByText(/^Then \(Dec 8\): Gate test 6\/10/)).toBeVisible();
  await expect(page.getByText(/V-pulls and outside-touch gate Gate test: 7\/10 \(R 4\/5 · L 3\/5\), up from 6\/10/)).toBeVisible();
  await button(page, '1 month ago').click();
  await expect(page.getByText(/^Then \(Dec 8\)/)).toBeVisible();
  await button(page, '3 months ago').click();
  await expect(page.getByText(/^Then \(Nov 3\): Gate test 5\/10/)).toBeVisible();
  await button(page, 'pick a date').click();
  await page.locator('input[type=date]').fill('2026-11-20');
  await expect(page.getByText(/^Then \(Nov 3\)/)).toBeVisible();
  await expect(page.locator('table.data tr')).toHaveCount(3);
});
