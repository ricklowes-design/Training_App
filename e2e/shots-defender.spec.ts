import { test } from '@playwright/test';
import { advance, boot, button, openParent, place, setup, start } from './helpers';

// Screenshots of the 3D defender in a block (docs/screens 60 and docs/screens/defender). Runs only with SHOTS=1:
//   SHOTS=1 npx playwright test e2e/shots-defender.spec.ts
test.skip(!process.env.SHOTS, 'screenshots only');

test('defender block screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await boot(page);
  await setup(page, { name: 'Sam' });
  await place(page, 'Feinting', 9);
  await start(page, 'Feinting · Stage 3 · Session 9');
  await advance(page, 191_000);
  await button(page, '▶ Start block').click();
  await advance(page, 10_500);
  await page.waitForTimeout(3000); // real time for the 3D module to load
  await page.clock.runFor(3000);
  await page.screenshot({ path: 'docs/screens/60-defender-block.png' });
});

/** Each reaction at its telling moment, from Parent → 3D defender test (real time; ±0.1 s). */
test('defender positions', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page, { clock: false });
  await setup(page, { name: 'Sam' });
  await openParent(page, /^3D defender test/);
  const view = page.getByTestId('defender-3d');
  await view.waitFor();
  await page.waitForTimeout(2500); // the 3D module loads
  await page.getByLabel('Freeze at a moment').check();
  const at = async (caseName: string, angle: string, sec: number, file: string) => {
    await button(page, angle).click();
    await button(page, caseName).click();
    await page.getByLabel('Moment in the rep (s)').fill(String(sec));
    await page.waitForTimeout(400);
    await view.screenshot({ path: `docs/screens/defender/${file}.png` });
  };
  // Approach 0–1.8 s; trigger 2.2 s; reaction from 2.45 s; a commit is full by about 2.8 s; late reactions wait 0.42 s more; a recovery ends by about 3.5 s.
  await at('Hold', 'approach -20°', 0.4, '01-approach-from-left');
  await at('Hold', 'approach 25°', 0.4, '02-approach-from-right');
  await at('Hold', 'approach 0°', 2.3, '03-stance-reading');
  await at('Commit left', 'approach 0°', 3.0, '04-commit-left');
  await at('Commit right', 'approach 0°', 3.0, '05-commit-right');
  await at('Hold', 'approach 0°', 3.0, '06-hold');
  await at('Late reaction', 'approach 0°', 2.75, '07-late-reaction-waiting');
  await at('Late reaction', 'approach 0°', 3.5, '08-late-reaction-committed');
  await at('Commit then recover', 'approach 0°', 2.85, '09-commit-then-recover-committed');
  await at('Commit then recover', 'approach 0°', 3.2, '10-commit-then-recover-coming-back');
  await at('Commit then recover', 'approach 0°', 3.7, '11-commit-then-recover-recovered');
});
