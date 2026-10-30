// Storage helpers for the save and recording paths (audit 2026-10-29, task 8).

/** A full-disk error, directly or wrapped by Dexie (`inner`). */
export function isQuota(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const inner = (e as { inner?: unknown }).inner;
  return e.name === 'QuotaExceededError' || (inner instanceof Error && inner.name === 'QuotaExceededError');
}

/** Free and total space for this app, in MB (undefined where the browser doesn't say). */
export async function storageMB(): Promise<{ usedMB: number; quotaMB: number; freeMB: number } | undefined> {
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  if (!est?.quota || est.usage === undefined) return undefined;
  return { usedMB: Math.round(est.usage / 1e6), quotaMB: Math.round(est.quota / 1e6), freeMB: Math.round((est.quota - est.usage) / 1e6) };
}

/** A block is about 70 MB at the recording bit rate; below this much free space, recording is not started. */
export const MIN_FREE_MB_TO_RECORD = 300;

export const SAVE_FULL = 'The Chromebook has no room left for this app. Delete old clips in Parent → Clips, then tap Try again. Nothing is lost while this screen stays open.';
export const saveFailedText = (e: unknown) =>
  isQuota(e) ? SAVE_FULL : `This session could not be saved yet (${e instanceof Error ? e.message : String(e)}). Tap Try again. Nothing is lost while this screen stays open.`;
