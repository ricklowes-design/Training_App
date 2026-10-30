import type { Programme } from '../content/types';
import { db } from '../db/db';
import type { SessionRecord, Settings } from '../db/types';
import { areaName } from '../domain/plans';
import { tryFill } from '../domain/templates';

// Completion messages to a chat webhook (plan/14, opt-in): the Chromebook posts when a session
// ends, so no server is needed. Only one small record per completed session leaves the device:
// date, area, session number, status and minutes (14.4), worded by the content's templates. A first
// name is added only when the parent switches on "Include the player's first name" (default off).
// Messages that cannot be sent (offline) wait in a queue and go on the next open.

export type NotifySettings = NonNullable<Settings['notify']>;
export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: string;
  record: { date: string; areaId?: string; sessionNumber?: number; status: string; minutes: number };
}

export const DISCORD_URL = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
export const TELEGRAM_TOKEN = /^\d+:[\w-]{20,}$/;

/** Whether the channel is set up enough to send. */
export function configured(n: NotifySettings | undefined): boolean {
  if (!n) return false;
  if (n.channel === 'discord') return DISCORD_URL.test(n.webhookUrl ?? '');
  return TELEGRAM_TOKEN.test(n.telegramToken ?? '') && /^-?\d+$/.test(n.telegramChatId ?? '');
}

export const paused = (n: NotifySettings | undefined, now = new Date()) => !!n?.pausedUntil && now.toISOString().slice(0, 10) <= n.pausedUntil;

/** The completion message for a finished record, or null when nothing should be sent (partial, stopped, trial, extra). */
export function completionMessage(p: Programme, r: SessionRecord, firstName?: string): QueuedMessage | null {
  if (r.kind !== 'programme' || r.trial || (r.status !== 'completed' && r.status !== 'completedBenchmarkSkipped')) return null;
  // Same wording and block count as the session summary.
  const area = r.areaId ? areaName(p, r.areaId) : '';
  const blocks = r.blocks.filter((b) => b.attempt === 1 && ['warmup', 'work', 'benchmark', 'anchor', 'quiz'].includes(b.kind)).length;
  const body =
    tryFill(p.feedbackTemplates, 'completed', { area, n: r.sessionNumber ?? '', blocks, minutes: Math.round(r.plannedMinutes) }) ?? `${area} Session ${r.sessionNumber ?? ''} complete.`;
  const skipped = r.status === 'completedBenchmarkSkipped' ? tryFill(p.feedbackTemplates, 'benchmarkSkippedNote', {}) : null;
  const text = `${firstName ? `${firstName}: ` : ''}${body}${skipped ? ` ${skipped}` : ''}`;
  return {
    id: r.id,
    text,
    createdAt: new Date().toISOString(),
    record: { date: r.date.slice(0, 10), areaId: r.areaId, sessionNumber: r.sessionNumber, status: r.status, minutes: r.plannedMinutes },
  };
}

/** Sends one message; throws when the service did not accept it. */
export async function sendText(n: NotifySettings, text: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (n.channel === 'discord') {
    const body = new FormData();
    body.append('content', text);
    const res = await fetchImpl(n.webhookUrl!, { method: 'POST', body });
    if (!res.ok) throw new Error(`Discord answered ${res.status}`);
    return;
  }
  const res = await fetchImpl(`https://api.telegram.org/bot${n.telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: n.telegramChatId, text }),
  });
  if (!res.ok) throw new Error(`Telegram answered ${res.status}`);
}

/** Sends what is queued, oldest first, stopping at the first failure (kept for next time). */
export async function flushQueue(fetchImpl: typeof fetch = fetch): Promise<{ sent: number; left: number }> {
  const s = await db.settings.get('main');
  const n = s?.notify;
  if (!s?.flags.notifications || !configured(n) || paused(n) || !n?.queue?.length) return { sent: 0, left: n?.queue?.length ?? 0 };
  let sent = 0;
  const queue = [...n.queue];
  while (queue.length) {
    try {
      await sendText(n, queue[0].text, fetchImpl);
    } catch {
      break;
    }
    queue.shift();
    sent++;
  }
  const latest = await db.settings.get('main');
  await db.settings.update('main', { notify: { ...(latest?.notify ?? n), queue } });
  return { sent, left: queue.length };
}

/** After a run: queue a message for each completed record (when notifications are on), then try to send. */
export async function notifyFinished(p: Programme, records: SessionRecord[], fetchImpl: typeof fetch = fetch): Promise<void> {
  const s = await db.settings.get('main');
  if (!s?.flags.notifications || !configured(s.notify) || paused(s.notify)) return;
  const msgs = records.map((r) => completionMessage(p, r, s.notify!.includeName ? s.notify!.firstName : undefined)).filter((m): m is QueuedMessage => !!m);
  if (!msgs.length) return;
  const queue = [...(s.notify!.queue ?? []).filter((q) => !msgs.some((m) => m.id === q.id)), ...msgs].slice(-30);
  await db.settings.update('main', { notify: { ...s.notify!, queue } });
  await flushQueue(fetchImpl);
}
