import { expect, test, type Page } from '@playwright/test';
import { advance, boot, button, closeParent, home, openParent, parentMenu, patchSettings, place, runToEnd, setup, start, startBlockNow, startCard, table } from './helpers';

async function ready(page: Page) {
  await boot(page);
  await setup(page);
  await patchSettings(page, { cueEngine: false });
}

test('plan/06 §6.6: a coach note and a cue change show in the drill’s demo view; history lists both; revert restores', async ({ page }) => {
  await ready(page);
  await place(page, 'Feinting', 6);
  // Note on F3.
  await openParent(page, /^Coach notes/);
  await page.locator('select').first().selectOption('F3');
  await page.getByPlaceholder(/Smaller scissors/).fill('Smaller scissors, faster exit touch.');
  await button(page, 'Save note').click();
  await expect(page.locator('li', { hasText: 'Smaller scissors' })).toContainText('coach via parent');
  // Adjust F3's cue.
  await parentMenu(page);
  await button(page, /^Adjust drills/).click();
  await page.locator('select').first().selectOption('F3');
  await page.getByLabel('Coaching cues (one per line)').fill('Half-size circle, exit touch before the plant foot lands');
  await button(page, 'Save changes').click();
  await expect(page.getByText(/1 change saved/)).toBeVisible();
  await closeParent(page);
  // Feinting S6 starts with F3: its demo view shows the amended cue and the dated note.
  await start(page, 'Feinting · Stage 2 · Session 6');
  await advance(page, 191_000);
  await button(page, '✓ Cones are out: show the instructions').click();
  await expect(page.getByText('Half-size circle, exit touch before the plant foot lands')).toBeVisible();
  await expect(page.getByText('Coach note (Nov 3): “Smaller scissors, faster exit touch.”')).toBeVisible();
  await button(page, 'STOP').click();
  await home(page);
  // History lists the change with the previous text; revert restores it.
  await openParent(page, /^History/);
  const row = page.locator('tr', { hasText: 'F3' });
  await expect(row).toContainText('was: ["Small circle, big push","Exit through the gate"]');
  await expect(page.locator('li', { hasText: 'adjust drill' })).toBeVisible();
  await button(row, 'Revert').click();
  await expect(row).toContainText('reverted');
  await parentMenu(page);
  await button(page, /^Adjust drills/).click();
  await page.locator('select').first().selectOption('F3');
  await expect(page.getByLabel('Coaching cues (one per line)')).toHaveValue('Small circle, big push\nExit through the gate');
  // Resolving the note removes it from the demo view.
  await parentMenu(page);
  await button(page, /^Coach notes/).click();
  await button(page.locator('li', { hasText: 'Smaller scissors' }), 'Mark resolved').click();
  await expect(page.locator('li', { hasText: 'Smaller scissors' })).toContainText('resolved');
});

test('session blocks: replace a drill, the total must stay equal, saved as an override', async ({ page }) => {
  await ready(page);
  await openParent(page, /^Session blocks/);
  await page.locator('select').first().selectOption('dribbling-1');
  await page.locator('tr', { hasText: 'work' }).first().locator('select').selectOption('D2');
  await button(page, 'Add a drill block').click();
  await expect(page.getByText('Total 23 of 20 min — must equal the session length')).toBeVisible();
  await expect(button(page, 'Save')).toBeDisabled();
  await page.locator('tr', { hasText: 'work' }).last().getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Total 20 of 20 min')).toBeVisible();
  await button(page, 'Save').click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await closeParent(page);
  await place(page, 'Dribbling', 1);
  await expect(startCard(page, 'Dribbling · Stage 1 · Session 1')).toContainText('Push-and-go + Slalom close control');
});

test('a new drill created in coach mode appears in the content list and the session editor', async ({ page }) => {
  await ready(page);
  await openParent(page, /^Adjust drills/);
  await button(page, 'New drill').click();
  const m = page.locator('.modal');
  await m.getByLabel(/^Id/).fill('f9');
  await m.getByLabel('Name').fill('Stepover exit');
  await m.getByLabel('Area').selectOption('feinting');
  await m.getByLabel('Prescription').fill('6 each side x 2');
  await m.getByLabel('Cues (one per line)').fill('Step over, then go');
  await button(m, 'Create drill').click();
  await parentMenu(page);
  await button(page, /^Content/).click();
  await expect(page.getByRole('cell', { name: 'F9', exact: true })).toBeVisible();
  await expect(page.getByText('custom drills: 1')).toBeVisible();
});

test('priorities: ticking a skill tags its area and breaks ties in the suggestion', async ({ page }) => {
  await ready(page);
  for (const [a, n] of [['Scanning', 1], ['Feinting', 5], ['Dribbling', 5], ['Ball control', 3]] as const) await place(page, a, n);
  await openParent(page, /^Priorities/);
  const checked = page.getByRole('checkbox', { checked: true });
  while ((await checked.count()) > 0) {
    const n = await checked.count();
    await checked.first().click();
    await expect(checked).toHaveCount(n - 1);
  }
  await page.getByLabel(/^head up/).click(); // saved to the database, so the box updates a moment later
  await expect(page.getByLabel(/^head up/)).toBeChecked();
  await closeParent(page);
  // Equal weeks: the priority area (dribbling) is suggested first.
  await expect(page.locator('.card.row', { hasText: 'Start' }).first()).toContainText('Dribbling · Stage 2 · Session 5');
  await button(page, 'Progress').click();
  await button(page, 'Skills').click();
  await expect(page.locator('.card', { hasText: 'DRIBBLING' }).locator('.pill.info')).toHaveText('priority');
  await expect(page.locator('.card', { hasText: 'SCANNING' }).locator('.pill.info')).toHaveCount(0);
});

test('advancement: criteria met → awaiting confirmation; parent checks; confirm unlocks the stage with a milestone', async ({ page }) => {
  await ready(page);
  await place(page, 'Scanning', 3);
  for (const n of [3, 4]) {
    // Repeated success on different days (part 15 D12): the second session is the next day.
    if (n === 4) await page.clock.setSystemTime(new Date('2026-11-04T17:00:00'));
    await start(page, `Scanning · Stage 1 · Session ${n}`);
    await runToEnd(page, {
      onForm: async (p) => {
        await p.getByRole('button', { name: 'Correct decisions /10 9', exact: true }).click();
        await button(p, 'Confirm').click();
      },
    });
    if (n === 4) {
      await expect(page.locator('.card', { hasText: 'Scanning · Session 4' })).toContainText('Criteria met: SB >= 8/10 at 3 s, two consecutive, both feet. Stage 2 unlocks after a parent confirms.');
    }
    await home(page);
  }
  // Stage 2 waits: the suggestion is to repeat S4.
  await expect(startCard(page, 'Repeat (stage criteria pending) · Scanning · Stage 1 · Session 4')).toBeVisible();
  await button(page, 'Progress').click();
  await button(page, 'Skills').click();
  await expect(page.locator('.card', { hasText: 'SCANNING' })).toContainText('criteria met: awaiting parent confirmation');
  await button(page, 'Home').click();
  // Parent: confirm needs the parent check ticked.
  await openParent(page, /^Advancement/);
  const card = page.locator('.card', { hasText: 'Scanning and decision-making: to Stage 2' });
  await expect(card).toContainText('qualifying tests on 2 of 2 different days');
  await expect(button(card, 'Confirm advancement')).toBeDisabled();
  await card.getByLabel('Both feet were used in the tests').check();
  await button(card, 'Confirm advancement').click();
  await expect(page.locator('li', { hasText: 'st1 → st2: confirmed' })).toBeVisible();
  await closeParent(page);
  await expect(page.getByText('Scanning: Stage 2 confirmed')).toBeVisible(); // milestone card
  await home(page);
  await expect(startCard(page, 'Scanning · Stage 2 · Session 5')).toBeVisible();
});

test('advancement: withhold with a reason, custom criterion, advance anyway', async ({ page }) => {
  await ready(page);
  await place(page, 'Feinting', 1);
  await openParent(page, /^Advancement/);
  const card = page.locator('.card', { hasText: 'Feinting and 1v1: to Stage 2' });
  await expect(button(card, 'Confirm advancement')).toBeDisabled(); // criteria not met
  await expect(button(card, 'Withhold')).toBeDisabled(); // needs a reason
  await card.getByPlaceholder('Custom extra criterion').fill('Left-foot exits filmed and approved');
  await button(card, 'Add criterion').click();
  await expect(card).toContainText('Extra criterion: Left-foot exits filmed and approved');
  await button(card, 'Mark met').click();
  await expect(card.locator('.pill.go').first()).toHaveText('met');
  await card.getByPlaceholder(/Reason/).fill('coach wants more pace first');
  await button(card, 'Withhold').click();
  await expect(card).toContainText('Withheld Nov 3: coach wants more pace first');
  await button(card, 'Advance anyway').click();
  await expect(page.locator('li', { hasText: 'feinting' }).or(page.locator('li', { hasText: 'Feinting' })).first()).toBeVisible();
  const adv = await table<{ decision: string; reason?: string }>(page, 'advancements');
  expect(adv.map((a) => a.decision)).toEqual(['withheld', 'confirmed']);
  expect(adv[1].reason).toMatch(/^advanced without the criteria/);
});

test('transfer observation: saved, shown as stage 4 evidence and a milestone', async ({ page }) => {
  await ready(page);
  await place(page, 'Scanning', 1);
  await openParent(page, /^Transfer observation/);
  await page.getByLabel('Behaviour seen').fill('final look before receiving, twice');
  await page.getByLabel('Seen on').fill('2026-11-01');
  await button(page, 'Save observation').click();
  await expect(page.locator('li', { hasText: '2026-11-01 · Scanning · coach via parent: final look before receiving, twice' })).toBeVisible();
  await closeParent(page);
  await expect(page.getByText(/Coach transfer note recorded for Scanning/)).toBeVisible();
});

test('coach export: area, stage, drill, question, last results and criteria; copy and save', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  await place(page, 'Feinting', 9);
  await openParent(page, /^Export for the coach/);
  await page.getByLabel('Area').selectOption('feinting');
  await page.getByLabel('Drill asked about (optional)').selectOption('F6');
  await page.getByLabel('Question (optional)').fill('Is the double feint right?');
  const pre = page.locator('pre');
  await expect(pre).toContainText('Feinting and 1v1 — Stage 3 (REACT), next session 9');
  await expect(pre).toContainText('Drill asked about: F6 Defender response');
  await expect(pre).toContainText('Question: Is the double feint right?');
  await expect(pre).toContainText('none yet');
  await expect(pre).toContainText('Next criteria: F5 cue accuracy >= 14/16');
  await button(page, 'Copy text').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Drill asked about: F6');
  const [dl] = await Promise.all([page.waitForEvent('download'), button(page, 'Save as file').click()]);
  expect(dl.suggestedFilename()).toBe('coach-export-feinting.txt');
});

test('cue drill builder: edit, preview, reset; new cue drill', async ({ page }) => {
  await ready(page);
  await openParent(page, /^Cue drills/);
  const row = page.locator('tr', { hasText: '(cue-defender)' });
  await expect(row).toContainText('BIT / HELD / BLOCKED');
  await button(row, 'Edit').click();
  await page.getByLabel(/Share of reps/).fill('0.25');
  await page.getByLabel(/BLOCKED on the shaping side/).check();
  await page.getByLabel(/Second cue/).uncheck();
  await page.getByLabel(/Second cue/).check();
  await button(page, 'Preview 30 s').click();
  await expect(page.locator('.cue-screen')).toBeVisible();
  await advance(page, 3_000);
  await page.locator('.practice.cue').click();
  await button(page, 'Save').click();
  await expect(row).toContainText('catch 25%');
  await expect(row).toContainText(/changed Nov 3/);
  await button(row, 'Reset').click();
  await expect(row).toContainText('catch 0%');
  // New cue drill.
  await button(page, 'New cue drill').click();
  await page.getByLabel(/^Id/).fill('cue-test');
  await page.getByLabel('Values shown', { exact: false }).fill('go, stop');
  await button(page, 'Save').click();
  await expect(page.locator('tr', { hasText: '(cue-test)' })).toContainText('GO / STOP');
});

test('demonstrations: own clip loops in the demo view; a link that cannot play shows the fallback', async ({ page }) => {
  // Stand in for YouTube: the uploader has disabled embedding (error 150).
  await page.addInitScript(() => {
    (window as unknown as { YT: unknown }).YT = {
      Player: class {
        constructor(_el: unknown, opts: { events: { onError: (e: { data: number }) => void } }) {
          setTimeout(() => opts.events.onError({ data: 150 }), 10);
        }
        destroy() {}
      },
    };
  });
  await ready(page);
  // Make a short real video clip in the browser for the upload.
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const ctx = c.getContext('2d')!;
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `hsl(${i * 30},80%,50%)`;
      ctx.fillRect(0, 0, 160, 90);
      await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => {
      rec.onstop = r;
      rec.stop();
    });
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = '';
    buf.forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s);
  });
  await openParent(page, /^Demonstrations/);
  const d1 = page.locator('.card', { hasText: 'D1 · Slalom close control' });
  await d1.locator('input[type=file]').setInputFiles({ name: 'd1.webm', mimeType: 'video/webm', buffer: Buffer.from(b64, 'base64') });
  await expect(page.getByText('D1: clip stored.')).toBeVisible();
  await expect(d1).toContainText('Own clip stored');
  const d2 = page.locator('.card', { hasText: 'D2 · Push-and-go' });
  await expect(button(d2, 'Save link')).toBeDisabled();
  await d2.getByLabel('D2 link').fill('https://youtu.be/abcdefghijk');
  await button(d2, 'Save link').click();
  await closeParent(page);
  await place(page, 'Dribbling', 2);
  await start(page, 'Dribbling · Stage 1 · Session 2');
  await advance(page, 191_000);
  await button(page, '✓ Cones are out: show the instructions').click();
  await expect(page.locator('.demo video')).toHaveAttribute('loop', '');
  await startBlockNow(page);
  await advance(page, 10_000 + 360_000 + 21_000 + 61_000); // D1, card, rest
  await button(page, '✓ Cones are out: show the instructions').click(); // D2 moves to the feint lane
  await expect(page.getByText('The uploader does not allow this video to play inside other apps.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdefghijk');
});
