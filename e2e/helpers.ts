import { expect, type Locator, type Page } from '@playwright/test';

export const PIN = '1234';
export const START = new Date('2026-11-03T17:00:00'); // a Tuesday

/** Opens the app, optionally on Playwright's fake clock (timers and Date move only when the test says so). */
export async function boot(page: Page, opts: { clock?: boolean; time?: Date } = {}): Promise<void> {
  if (opts.clock !== false) await page.clock.install({ time: opts.time ?? START });
  await page.goto('/');
}

export const button = (page: Page | Locator, name: string | RegExp) => page.getByRole('button', { name }).first();

/** First-run set-up with defaults; the room length can be changed. */
export async function setup(page: Page, opts: { name?: string; length?: string; focus?: boolean } = {}): Promise<void> {
  await page.getByLabel("Player's first name").fill(opts.name ?? 'Sam');
  await button(page, 'Next').click();
  // Your space: measure the room, skip the photo, nothing to measure from, the training space.
  if (opts.length) await page.getByLabel('Room length metres').fill(opts.length);
  await button(page, 'Next: take a photo of the space').click();
  await button(page, 'Skip the photo').click();
  await button(page, 'Next: your training space').click();
  for (let i = 0; i < 4; i++) await button(page, 'Next').click();
  await page.getByLabel('Parent PIN (4 digits)').fill(PIN);
  await button(page, 'Finish set-up').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${opts.name ?? 'Sam'} · Week of`);
  // The other areas' start cards sit behind "Choose a focus" (D14); it stays open for the browser session.
  if (opts.focus !== false) await openFocus(page);
}

export async function openParent(page: Page, section?: string | RegExp): Promise<void> {
  await button(page, 'Parent mode').click();
  const pin = page.getByLabel('PIN', { exact: true });
  if (await pin.isVisible().catch(() => false)) {
    await pin.fill(PIN);
    await button(page, 'Open').click();
  }
  await expect(page.getByRole('heading', { name: 'Parent and coach mode' })).toBeVisible();
  if (section) await page.getByRole('button', { name: section }).first().click();
}

export async function parentMenu(page: Page): Promise<void> {
  await button(page, 'Parent menu').click();
}

export async function closeParent(page: Page): Promise<void> {
  await button(page, 'Close parent mode').click();
}

/** Parent → Placement → place an area at a session without a baseline. */
export async function place(page: Page, area: string, session: number): Promise<void> {
  await openParent(page, /^Placement/);
  await page.locator('.card', { hasText: area }).getByRole('button', { name: /Place without a baseline|Change placement/ }).click();
  await page.getByLabel('Start at session').selectOption(String(session));
  await page.getByLabel('Reason (logged)').fill('test placement');
  await button(page, 'Save').click();
  await expect(page.locator('.card', { hasText: area }).first()).toContainText(`Started at Session ${session}`);
  await closeParent(page);
}

export const startCard = (page: Page, title: string | RegExp) => page.locator('.card.row', { hasText: title });

/** Sets the trial box on a start card and taps Start. */
export async function start(page: Page, title: string | RegExp, opts: { trial?: boolean } = {}): Promise<void> {
  const card = startCard(page, title);
  // Other areas sit behind "Choose a focus" on the home screen (D14).
  const focus = page.getByRole('button', { name: /^Choose a focus/ });
  if (!(await card.isVisible().catch(() => false)) && (await focus.getAttribute('aria-expanded').catch(() => null)) === 'false') await focus.click();
  // Retried as a unit: the home screen can re-render while live data arrives.
  await expect(async () => {
    await expect(card).toBeVisible({ timeout: 2000 });
    const box = card.getByRole('checkbox');
    if ((await box.isChecked()) !== !!opts.trial && (await box.isEnabled())) await box.click({ timeout: 2000 });
    await expect(box).toBeChecked({ checked: !!opts.trial, timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await button(card, 'Start').click();
}

/** Moves the fake clock forward in steps so the app's intervals keep up. */
export async function advance(page: Page, ms: number, step = 30_000): Promise<void> {
  for (let left = ms; left > 0; left -= step) await page.clock.runFor(Math.min(step, left));
}

/** Fills every number still blank on a result card (one tap each) and returns the Confirm button. */
export async function fillForm(page: Page, value = 5): Promise<Locator> {
  const blanks = page.locator('.count[data-blank]');
  for (let n = await blanks.count(); n > 0; n = await blanks.count()) {
    const group = blanks.first();
    const label = (await group.getAttribute('aria-label')) ?? '';
    const max = (await group.locator('.count-row button').count()) - 1;
    const v = Math.min(value, max);
    await group.getByRole('button', { name: `${label} ${v}`, exact: true }).click();
  }
  const times = page.locator('.stepper[data-blank]');
  for (let n = await times.count(); n > 0; n = await times.count()) await times.first().getByRole('button', { name: /start$/ }).click();
  return page.getByRole('button', { name: 'Confirm', exact: true });
}

/** Opens the "Choose a focus" panel on the home screen when it is closed. */
export async function openFocus(page: Page): Promise<void> {
  const focus = page.getByRole('button', { name: /^Choose a focus/ });
  if ((await focus.getAttribute('aria-expanded')) === 'false') await focus.click();
}

/** Lets a session run by itself to the end. Result cards are filled with one tap per number (5 unless the test says otherwise). */
export async function runToEnd(page: Page, opts: { maxMinutes?: number; onForm?: (page: Page) => Promise<void>; onTimed?: (page: Page) => Promise<void> } = {}): Promise<void> {
  const max = (opts.maxMinutes ?? 70) * 2;
  for (let i = 0; i < max; i++) {
    if (await page.getByRole('heading', { name: /Session saved|baseline · parent questions/ }).isVisible().catch(() => false)) {
      // Let time flow again so new screens settle (Playwright waits for animation frames).
      await page.clock.resume();
      return;
    }
    const save = page.getByRole('button', { name: 'Confirm', exact: true });
    if (await save.isVisible().catch(() => false)) {
      if (opts.onForm) await opts.onForm(page);
      else await (await fillForm(page)).click();
      await expect(save).toBeHidden();
      continue;
    }
    // Slalom benchmark: both patterns on the tap-to-finish target (10 s each unless the test says otherwise).
    if ((await textOf(page.locator('.practice .drill'))) === 'Pattern R') {
      if (opts.onTimed) await opts.onTimed(page);
      else await slalom(page, 10, 10);
      continue;
    }
    await page.clock.runFor(30_000);
  }
  throw new Error('session did not finish');
}

/** Reads a whole IndexedDB table. */
export async function table<T = Record<string, unknown>>(page: Page, name: string): Promise<T[]> {
  return page.evaluate(
    (n) =>
      new Promise<T[]>((resolve, reject) => {
        const r = indexedDB.open('home-training');
        r.onsuccess = () => {
          const g = r.result.transaction(n).objectStore(n).getAll();
          g.onsuccess = () => resolve(g.result as T[]);
          g.onerror = () => reject(g.error);
        };
      }),
    name,
  );
}

/** Changes the settings record directly (for set-ups the parent would do in Settings). */
export async function patchSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (p) =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open('home-training');
        r.onsuccess = () => {
          const tx = r.result.transaction('settings', 'readwrite');
          const st = tx.objectStore('settings');
          const g = st.get('main');
          g.onsuccess = () => st.put({ ...g.result, ...p });
          tx.oncomplete = () => resolve();
        };
      }),
    patch,
  );
}

export async function home(page: Page): Promise<void> {
  const done = page.getByRole('button', { name: 'Done', exact: true });
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  const homeHeading = page.getByRole('heading', { level: 1, name: /· Week of/ });
  // From a summary ("Saving…" first), through any milestone cards, to the home screen.
  for (let i = 0; i < 30; i++) {
    await expect(homeHeading.or(ok).or(done)).toBeVisible({ timeout: 20_000 });
    if (await done.isVisible().catch(() => false)) {
      await done.click();
      continue;
    }
    if (await ok.isVisible().catch(() => false)) {
      // A plain DOM click: Playwright's click can wait on an animation frame that a busy fake-clock page delays.
      await ok.evaluate((el: HTMLElement) => el.click()).catch(() => undefined);
      await page.waitForTimeout(100);
      continue;
    }
    await page.waitForTimeout(300); // a milestone card can arrive a moment later
    if (!(await ok.isVisible().catch(() => false)) && (await homeHeading.isVisible().catch(() => false))) return;
  }
  throw new Error('did not reach the home screen');
}

/** Records what the app says instead of speaking it. Call before boot(). */
export async function captureSpeech(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __said: string[] };
    w.__said = [];
    if (window.speechSynthesis) window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void w.__said.push(u.text);
  });
  return () => page.evaluate(() => (window as unknown as { __said: string[] }).__said);
}

/** Runs both slalom patterns on the tap-to-finish target with the given times (seconds). */
export async function slalom(page: Page, rightS: number, leftS: number): Promise<void> {
  for (const [label, secs] of [['R', rightS], ['L', leftS]] as const) {
    await expect(page.locator('.practice .drill')).toHaveText(`Pattern ${label}`);
    await page.clock.runFor(8_100);
    await page.clock.runFor(secs * 1000);
    await page.getByRole('button', { name: 'Finish' }).click();
  }
}

/** Text of the first match, or '' when there is none (never waits). */
export async function textOf(l: Locator): Promise<string> {
  return (await l.count()) ? ((await l.first().textContent({ timeout: 2000 }).catch(() => '')) ?? '').trim() : '';
}

/** Word/arrow cues instead of the 3D defender (the D3 fallback path), for tests of the cue engine itself. */
export async function arrowCues(page: Page): Promise<void> {
  await patchSettings(page, { flags: { defender3d: false, liveOnsetDetector: false, speechDiagnostic: false, notifications: false, ballTracking: false, learning: false } });
}
