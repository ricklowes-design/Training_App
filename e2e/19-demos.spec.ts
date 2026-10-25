import { expect, test } from '@playwright/test';
import { boot, button, openParent, setup, table } from './helpers';

// Suggested outside demonstrations: preview, show only a part (looped), switch to an alternative, paste a link with a time.

type Opts = { videoId: string; playerVars: Record<string, number | string>; events: { onStateChange: (e: { data: number }) => void } };

test('demonstrations: suggested videos, a part of a video on a loop, alternatives', async ({ page }) => {
  test.setTimeout(120_000);
  // Stand in for YouTube's player: records how it was asked to play, and seeks.
  await page.addInitScript(() => {
    const w = window as unknown as { YT: unknown; __yt: Opts[]; __seeks: number[] };
    w.__yt = [];
    w.__seeks = [];
    w.YT = {
      Player: class {
        constructor(_el: unknown, opts: Opts) {
          w.__yt.push(opts);
        }
        destroy() {}
        pauseVideo() {}
        playVideo() {}
        seekTo(s: number) {
          w.__seeks.push(s);
        }
      },
    };
  });
  await boot(page, { clock: false });
  await setup(page);
  await openParent(page, /^Demonstrations/);
  const f3 = page.getByTestId('demo-F3');
  await expect(f3).toContainText('“How To Do The Single Scissor Soccer Football Move” · whole video');
  await expect(f3).toContainText('demonstration unverified');
  await button(f3, 'Preview').click();
  const last = () => page.evaluate(() => (window as unknown as { __yt: Opts[] }).__yt.at(-1)!);
  await expect.poll(async () => (await last())?.videoId).toBe('ox7EDXk7AX4');
  expect((await last()).playerVars.loop).toBe(1);

  // Show only 0:12–0:40, on a loop.
  await f3.getByLabel('F3 start').fill('0:12');
  await f3.getByLabel('F3 end').fill('0:40');
  await button(f3, 'Save part').click();
  await expect(page.getByText('F3: only that part will play, on a loop.')).toBeVisible();
  await expect(f3).toContainText('· 0:12–0:40 ·');
  await button(f3, 'Close preview').click();
  await button(f3, 'Preview').click();
  await expect.poll(async () => (await last()).playerVars.start).toBe(12);
  expect((await last()).playerVars.end).toBe(40);
  expect((await last()).playerVars.loop).toBeUndefined();
  await expect(f3).toContainText('showing 0:12–0:40, looped');
  // When the part ends it starts again.
  await page.evaluate(() => (window as unknown as { __yt: Opts[] }).__yt.at(-1)!.events.onStateChange({ data: 0 }));
  expect(await page.evaluate(() => (window as unknown as { __seeks: number[] }).__seeks)).toEqual([12]);
  await f3.getByLabel('F3 end').fill('0:05');
  await expect(button(f3, 'Save part')).toBeDisabled(); // the end must be after the start

  // An alternative.
  await button(f3, 'Use “Learn how to do the Scissors Move - Football Soccer 1v1 Tutorial”').click();
  await expect(f3).toContainText('“Learn how to do the Scissors Move - Football Soccer 1v1 Tutorial” · whole video');

  // A pasted link with a time sets the start.
  const d6 = page.getByTestId('demo-D6');
  await d6.getByLabel('D6 link').fill('https://youtu.be/abcdefghijk?t=1m5s');
  await button(d6, 'Save link').click();
  await expect(d6).toContainText('“Your link” · 1:05–end');
  const ov = await table<{ field: string; target: { id: string }; value: { startS?: number } }>(page, 'overrides');
  expect(ov.filter((o) => o.target.id === 'D6').at(-1)!.value.startS).toBe(65);
});
