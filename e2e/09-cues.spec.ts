import { expect, test, type Page } from '@playwright/test';
import { advance, arrowCues, boot, button, fillForm, home, openFocus, openParent, patchSettings, place, setup, start, table } from './helpers';

type Block = { index: number; drillId?: string; cueLevel?: string; cueLog?: { cueMs?: number; repStartMs: number; value?: string }[] };

async function toFirstWorkBlock(page: Page) {
  await advance(page, 191_000); // countdown + warm-up
  await button(page, '▶ Start block').click();
  await advance(page, 10_500); // countdown
}

/** Steps the clock until a cue is on screen. */
async function nextCue(page: Page): Promise<string> {
  for (let i = 0; i < 80; i++) {
    await page.clock.runFor(250);
    const word = page.locator('.cue-word');
    const arrow = page.locator('.cue-screen svg');
    if (await word.count()) return (await word.innerText()).trim();
    if (await arrow.count()) return `arrow:${await arrow.first().getAttribute('aria-label')}`;
  }
  throw new Error('no cue appeared');
}

test('arrow cues fill the screen in a cue drill; the cue log is saved with the block', async ({ page }) => {
  await boot(page);
  await setup(page);
  await arrowCues(page);
  await place(page, 'Feinting', 9);
  await start(page, 'Feinting · Stage 3 · Session 9');
  await toFirstWorkBlock(page);
  await expect(page.locator('.practice.cue')).toBeVisible();
  await expect(page.getByText(/^rep 1/)).toBeVisible();
  const first = await nextCue(page);
  expect(['arrow:LEFT', 'arrow:RIGHT']).toContain(first);
  const box = await page.locator('.cue-screen svg').boundingBox();
  expect(box!.height).toBeGreaterThan(768 / 3); // at least a third of the screen height
  // A minute of reps, then end the block.
  await advance(page, 60_000, 250);
  await button(page, 'DONE').click();
  await button(page, /^Next/).click();
  await button(page, 'STOP').click(); // from the next demo view
  await expect(page.getByRole('heading', { name: 'Session saved' })).toBeVisible();
  const [rec] = await table<{ blocks: Block[] }>(page, 'sessionRecords');
  const f5 = rec.blocks.find((b) => b.drillId === 'F5')!;
  expect(f5.cueLevel).toBe('engine-timed');
  expect(f5.cueLog!.length).toBeGreaterThanOrEqual(6);
  for (const e of f5.cueLog!.filter((x) => x.cueMs !== undefined)) {
    expect(e.cueMs! - e.repStartMs).toBeGreaterThanOrEqual(1500);
    expect(e.cueMs! - e.repStartMs).toBeLessThanOrEqual(2600);
  }
  // Parent → Cue drills → Recent cue logs lists them.
  await home(page);
  await openParent(page, /^Cue drills/);
  await button(page, 'Recent cue logs').click();
  await expect(page.locator('.modal')).toContainText('block 2 F5 · engine-timed');
  await expect(page.locator('.modal tr', { hasText: /LEFT|RIGHT/ }).first()).toBeVisible();
});

test('word cues: the SB benchmark runs its 10 reps at the stage cue duration, then asks for the score', async ({ page }) => {
  await boot(page);
  await setup(page);
  await place(page, 'Scanning', 3);
  await start(page, 'Scanning · Stage 1 · Session 3');
  // Skip the two work blocks to reach the benchmark.
  await advance(page, 191_000);
  await button(page, 'Skip block').click(); // S2
  await advance(page, 61_000); // rest
  await button(page, 'Skip block').click(); // S2 again (S3 is now an optional diagnostic)
  await expect(page.getByRole('heading', { name: /Benchmark · Cue-behind decision test/i })).toBeVisible();
  await button(page, '▶ Start block').click();
  await advance(page, 10_500);
  const cue = await nextCue(page);
  expect(['LEFT FREE', 'RIGHT FREE', 'BOTH BLOCKED']).toContain(cue);
  // Shown for the stage's 3 s, then cleared.
  await page.clock.runFor(2_500);
  await expect(page.locator('.cue-word')).toHaveText(cue);
  await page.clock.runFor(800);
  await expect(page.locator('.cue-word')).toHaveCount(0);
  // 10 reps of 9 s end the block by themselves.
  await advance(page, 95_000, 1_000);
  await expect(page.locator('.count', { hasText: 'Correct decisions /10' })).toBeVisible();
  await expect(page.getByText('layout v1 · level 3')).toBeVisible();
});

test('anchor A3 with the cue engine records the engine condition', async ({ page }) => {
  await boot(page);
  await setup(page);
  await openFocus(page);
  await button(page, 'Anchor check · due').click();
  await page.getByRole('checkbox').uncheck();
  await button(page, 'Start').click();
  const levels: string[] = [];
  for (let i = 0; i < 200 && levels.length < 4; i++) {
    const save = page.getByRole('button', { name: 'Confirm', exact: true });
    if (await save.isVisible().catch(() => false)) {
      levels.push(await page.locator('.pill.info').innerText());
      await fillForm(page);
      await save.click();
      await expect(save).toBeHidden();
      continue;
    }
    if ((await page.locator('.practice .drill').count()) && (await page.locator('.practice .drill').textContent())?.trim() === 'Pattern R') {
      for (const _ of [0, 1]) {
        await page.clock.runFor(8_100 + 10_000);
        await page.getByRole('button', { name: 'Finish' }).click();
      }
      continue;
    }
    await page.clock.runFor(10_000);
  }
  expect(levels).toEqual([
    'anchor layout (fixed) · level std',
    'anchor layout (fixed) · level std',
    'anchor layout (fixed) · level engine-timed',
    'anchor layout (fixed) · level engine-timed',
  ]);
});

test('cue engine off: cue drills show the normal practice view (SwitchedOn fallback)', async ({ page }) => {
  await boot(page);
  await setup(page);
  await patchSettings(page, { cueEngine: false });
  await arrowCues(page);
  await place(page, 'Feinting', 9);
  await start(page, 'Feinting · Stage 3 · Session 9');
  await toFirstWorkBlock(page);
  await expect(page.locator('.practice .clock')).toBeVisible();
  await expect(page.locator('.practice.cue')).toHaveCount(0);
});
