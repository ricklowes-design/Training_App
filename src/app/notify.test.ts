import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { DEFAULT_SETTINGS } from './data';
import { loadProgramme } from '../test/fixtures';
import { rec } from '../test/factories';
import { completionMessage, configured, flushQueue, notifyFinished, paused, sendText } from './notify';

const p = loadProgramme();
const discord = { channel: 'discord' as const, webhookUrl: 'https://discord.com/api/webhooks/123/abc-DEF' };
const okFetch = () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe('completion messages (plan/14)', () => {
  it('only completed programme sessions send, with only date, area, session, status and minutes', () => {
    const done = rec({ areaId: 'feinting', sessionNumber: 8, plannedMinutes: 20, blocks: [{ index: 1, kind: 'work', attempt: 1 }, { index: 3, kind: 'work', attempt: 1 }, { index: 5, kind: 'benchmark', attempt: 1 }] as never });
    const m = completionMessage(p, done, 'Sam')!;
    expect(m.text).toBe('Sam: Feinting Session 8 complete: all 3 blocks, 20 minutes.');
    expect(Object.keys(m.record).sort()).toEqual(['areaId', 'date', 'minutes', 'sessionNumber', 'status']);
    expect(completionMessage(p, rec({ status: 'partial' }))).toBeNull();
    expect(completionMessage(p, rec({ trial: true }))).toBeNull();
    expect(completionMessage(p, rec({ kind: 'extra' as never }))).toBeNull();
    expect(completionMessage(p, rec({ status: 'completedBenchmarkSkipped', areaId: 'feinting', sessionNumber: 3 }))!.text).toMatch(/\(Benchmark skipped\.\)$/);
  });

  it('checks the link, pauses, and posts to Discord or Telegram', async () => {
    expect(configured(discord)).toBe(true);
    expect(configured({ channel: 'discord', webhookUrl: 'https://example.com/hook' })).toBe(false);
    expect(configured({ channel: 'telegram', telegramToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWX', telegramChatId: '-1001' })).toBe(true);
    expect(paused({ ...discord, pausedUntil: '2026-11-10' }, new Date('2026-11-10T20:00:00Z'))).toBe(true);
    expect(paused({ ...discord, pausedUntil: '2026-11-10' }, new Date('2026-11-11T08:00:00Z'))).toBe(false);
    const d = okFetch();
    await sendText(discord, 'hello', d.f);
    expect(d.calls[0].url).toBe(discord.webhookUrl);
    expect((d.calls[0].init!.body as FormData).get('content')).toBe('hello');
    const t = okFetch();
    await sendText({ channel: 'telegram', telegramToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWX', telegramChatId: '42' }, 'hi', t.f);
    expect(t.calls[0].url).toBe('https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWX/sendMessage');
    expect(JSON.parse(t.calls[0].init!.body as string)).toEqual({ chat_id: '42', text: 'hi' });
  });

  it('queues when offline and sends on the next try; nothing when the feature is off', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, flags: { ...DEFAULT_SETTINGS.flags, notifications: true }, notify: discord });
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await notifyFinished(p, [rec({ id: 'r1', areaId: 'feinting', sessionNumber: 8 })], offline);
    expect((await db.settings.get('main'))!.notify!.queue).toHaveLength(1);
    const ok = okFetch();
    expect(await flushQueue(ok.f)).toEqual({ sent: 1, left: 0 });
    expect((await db.settings.get('main'))!.notify!.queue).toHaveLength(0);
    await db.settings.update('main', { flags: { ...DEFAULT_SETTINGS.flags, notifications: false } });
    const none = okFetch();
    await notifyFinished(p, [rec({ id: 'r2', areaId: 'feinting', sessionNumber: 9 })], none.f);
    expect(none.calls).toHaveLength(0);
  });
});
