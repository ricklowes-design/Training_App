import { expect, test, type Page } from '@playwright/test';
import { advance, boot, button, fillForm, home, patchSettings, place, runToEnd, setup, start, startBlockNow, table , holdStop } from './helpers';

// The 3D defender in scored reactive drills (part 15 D3, tasks 2.2–2.4).

type Scenario = { repIndex: number; triggerSource: string; view: string; archetype: string; reaction: string; correctExit: string; sessionRecordId: string; parametersVersion: string };
type Rec = { blocks: { drillId?: string; cueLevel?: string; defender?: { view: string; reps: number; triggerSources: string[]; fallbackReason?: string } }[] };

async function toDefenderBlock(page: Page) {
  await place(page, 'Feinting', 9);
  await start(page, 'Feinting · Stage 3 · Session 9');
  await advance(page, 191_000); // countdown + warm-up
  await startBlockNow(page);
  await advance(page, 10_500); // countdown
}

test('a reactive drill shows the 3D defender from the player view, with no arrows or words', async ({ page }) => {
  test.setTimeout(400_000);
  await boot(page);
  await setup(page);
  await toDefenderBlock(page);
  await expect(page.locator('.practice.defender')).toBeVisible();
  await expect(page.locator('[data-testid="defender-3d"], [data-testid="defender-2d"]')).toBeVisible();
  // The correct action is never signalled: no cue words or arrows during the block.
  for (let i = 0; i < 12; i++) {
    await page.clock.runFor(1000);
    await expect(page.locator('.cue-word')).toHaveCount(0);
    await expect(page.locator('.cue-screen svg')).toHaveCount(0);
  }
  await expect(page.locator('.practice.defender')).toContainText(/rep \d+ of 16/);
  // The whole block (scenarios, tally, observations) is checked in the 2D test below: software WebGL
  // in the test browser is too slow to fast-forward a full block at 60 frames a second.
  await holdStop(page);
});

test('the instructions teach reading the 3D defender, with no arrow (Brief R01)', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await setup(page);
  await place(page, 'Feinting', 9);
  await start(page, 'Feinting · Stage 3 · Session 9');
  await advance(page, 191_000);
  const cones = page.getByRole('button', { name: '✓ Cones are out: show the instructions' });
  if (await cones.isVisible().catch(() => false)) await cones.click();
  const rules = page.getByTestId('cue-rules');
  await expect(rules).toHaveAttribute('data-mode', 'defender3d');
  await expect(page.getByTestId('defender-read')).toBeVisible();
  await expect(rules).not.toContainText(/arrow/i);
});

test('without WebGL the drill falls back to word/arrow cues, recorded under the cue engine level', async ({ page }) => {
  test.setTimeout(200_000);
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error test override
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    };
  });
  await boot(page);
  await setup(page);
  const [s] = await table<{ capabilities: { webgl: boolean } }>(page, 'settings');
  expect(s.capabilities.webgl).toBe(false);
  await place(page, 'Feinting', 9);
  await start(page, 'Feinting · Stage 3 · Session 9');
  await advance(page, 191_000);
  const cones = page.getByRole('button', { name: '✓ Cones are out: show the instructions' });
  if (await cones.isVisible().catch(() => false)) await cones.click();
  // The fallback is named and teaches its own arrow (Brief R01).
  await expect(page.getByTestId('cue-rules')).toHaveAttribute('data-mode', 'cueFallback');
  await expect(page.getByTestId('mode-label')).toContainText('word or arrow instead');
  await button(page, '▶ Start block').click();
  await advance(page, 10_500);
  await expect(page.locator('.practice.cue')).toBeVisible();
  await expect(page.locator('.practice.defender')).toHaveCount(0);
});

test('when the 3D view cannot start, the block continues in the labelled 2D fallback and records it', async ({ page }) => {
  test.setTimeout(400_000);
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error test override
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if ((window as unknown as { __noGL?: boolean }).__noGL && (type === 'webgl' || type === 'webgl2')) return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    };
  });
  await boot(page);
  await setup(page);
  // The capability check passed at start; WebGL then fails when the block opens it.
  await patchSettings(page, { capabilities: { checkedAt: '2026-11-03', webgl: true, webgl2: true } });
  await page.evaluate(() => ((window as unknown as { __noGL: boolean }).__noGL = true));
  await toDefenderBlock(page);
  await expect(page.locator('[data-testid="defender-2d"]')).toBeVisible();
  await expect(page.locator('.practice.defender')).toContainText('2D fallback');
  await runToEnd(page, {
    onForm: async (p) => {
      if (await p.getByText('no camera · 16 reps').isVisible().catch(() => false)) {
        await expect(p.locator('.count[data-blank]')).toHaveCount(2);
        await expect(button(p, 'Confirm')).toBeDisabled();
      }
      await (await fillForm(p, 11)).click();
    },
  });
  await home(page);
  const recs = await table<Rec>(page, 'sessionRecords');
  const f5 = recs.flatMap((r) => r.blocks).find((b) => b.drillId === 'F5' && b.defender)!;
  expect(f5.defender!.reps).toBe(16);
  expect(f5.defender!.view).toBe('fallback2d');
  expect(f5.defender!.fallbackReason).toMatch(/3D could not start/);
  expect(f5.cueLevel).toMatch(/^defender-2d-/);
  // The block stores the training mode and instruction version it ran with (Brief R01).
  expect((f5 as { trainingMode?: string }).trainingMode).toBe('defender3d');
  expect((f5 as { instructionVersion?: string }).instructionVersion).toMatch(/:defender3d$/);
  const scen = await table<Scenario>(page, 'defenderScenarios');
  expect(scen.every((x) => x.view === 'fallback2d')).toBe(true);
  const first = scen.filter((x) => x.repIndex >= 0).slice(0, 16);
  expect(scen.length).toBeGreaterThanOrEqual(16);
  expect(new Set(first.map((x) => x.triggerSource))).toEqual(new Set(['plannedTiming']));
  expect(first.every((x) => x.parametersVersion === 'gd-1' && x.sessionRecordId)).toBe(true);
  for (const x of first) expect(['left', 'right', 'protect']).toContain(x.correctExit);
  const obs = await table<{ metricId: string; value: number; source: string; status: string; contextKey: { defenderArchetype?: string } }>(page, 'metricObservations');
  expect(obs.find((o) => o.metricId === 'correctResponseByDefenderAction')).toMatchObject({ value: 11, source: 'manual', status: 'verified' });
  expect(obs[0].contextKey.defenderArchetype).toBeTruthy();
});

test('PAUSE keeps the same 3D canvas (no new WebGL context per pause) and shows PAUSED over it (audit task 12)', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  await setup(page);
  await toDefenderBlock(page);
  const canvas = page.locator('[data-testid="defender-3d"]');
  await expect(canvas).toBeVisible();
  await canvas.evaluate((el) => ((el as HTMLElement).dataset.marker = 'first'));
  await button(page, 'PAUSE').click();
  await expect(page.locator('.paused-overlay')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-marker', 'first');
  await button(page, /^RESUME|^Resume/).click();
  await expect(page.locator('.paused-overlay')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-marker', 'first');
  await holdStop(page);
});
