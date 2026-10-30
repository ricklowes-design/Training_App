import { profileFromLegacyLayout } from '../domain/room';
import { BACKUP_TABLES, type BackupTable, type TrainingDB } from './db';

export const BACKUP_FORMAT = 'home-training-backup';
/** 3: camera set-ups included, nested blobs, no session-message credentials. */
export const BACKUP_FORMAT_VERSION = 3;

type EncodedBlob = { __blob: string; type: string };

const toBase64 = (buf: ArrayBuffer): string => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Blobs at any depth (room photos, floor maps, camera reference frames) become base64 so the backup stays one JSON file. */
async function encodeValue(v: unknown): Promise<unknown> {
  if (v instanceof Blob) return { __blob: toBase64(await v.arrayBuffer()), type: v.type } satisfies EncodedBlob;
  if (Array.isArray(v)) return Promise.all(v.map(encodeValue));
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = await encodeValue(x);
    return out;
  }
  return v;
}
export const encodeBlobs = (row: object) => encodeValue(row) as Promise<object>;

function decodeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === 'object') {
    if ('__blob' in v) {
      const e = v as EncodedBlob;
      return new Blob([Uint8Array.from(atob(e.__blob), (c) => c.charCodeAt(0))], { type: e.type });
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = decodeValue(x);
    return out;
  }
  return v;
}
export const decodeBlobs = (row: object) => decodeValue(row) as object;

/** Session-message credentials never go into a backup file, and never come back from one (Brief R05, audit task 10). */
export const SECRET_FIELDS = ['webhookUrl', 'telegramToken'] as const;
type NotifyRow = { notify?: Record<string, unknown> };
function withoutSecrets<T extends NotifyRow>(row: T): T {
  if (!row.notify) return row;
  const notify: Record<string, unknown> = { ...row.notify, queue: [] };
  for (const k of SECRET_FIELDS) delete notify[k];
  return { ...row, notify };
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  /** What was deliberately left out of this file. */
  omitted?: string[];
  tables: Partial<Record<BackupTable, unknown[]>>;
}

export async function exportBackup(database: TrainingDB, appVersion: string): Promise<Backup> {
  const tables: Backup['tables'] = {};
  const raw: Partial<Record<BackupTable, object[]>> = {};
  await database.transaction('r', BACKUP_TABLES.map((t) => database.table(t)), async () => {
    for (const t of BACKUP_TABLES) raw[t] = await database.table(t).toArray();
  });
  // The export copy loses the credentials; the live database keeps them.
  raw.settings = (raw.settings ?? []).map((r) => withoutSecrets(r as NotifyRow));
  for (const t of BACKUP_TABLES) tables[t] = await Promise.all((raw[t] ?? []).map(encodeBlobs));
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    omitted: ['recorded clips and own demo videos', 'session-message link or token'],
    tables,
  };
}

export type ImportResult =
  | { ok: true; counts: Record<string, number>; /** Session messages were on in the file but need their link or token entered here. */ messagesNeedSetup: boolean }
  | { ok: false; error: string };

/** Replaces everything in the backed-up tables with the file's contents. */
export async function importBackup(database: TrainingDB, text: string): Promise<ImportResult> {
  let data: Backup;
  try {
    data = JSON.parse(text) as Backup;
  } catch {
    return { ok: false, error: 'This file is not a backup (it is not valid JSON).' };
  }
  if (data?.format !== BACKUP_FORMAT || typeof data.tables !== 'object' || data.tables === null) {
    return { ok: false, error: 'This file is not a backup from this app.' };
  }
  if (data.formatVersion > BACKUP_FORMAT_VERSION) {
    return { ok: false, error: 'This backup was made by a newer version of the app. Reload the app and try again.' };
  }
  for (const t of BACKUP_TABLES) {
    const rows = data.tables[t];
    if (rows !== undefined && !Array.isArray(rows)) return { ok: false, error: `The backup's "${t}" section is damaged.` };
    if (rows && !rows.every((r) => r && typeof r === 'object')) return { ok: false, error: `The backup's "${t}" section is damaged.` };
  }
  // The device's own credentials stay; a file never brings any (old backups may contain them).
  const current = await database.settings.get('main').catch(() => undefined);
  let messagesNeedSetup = false;
  const counts: Record<string, number> = {};
  try {
    await database.transaction('rw', BACKUP_TABLES.map((t) => database.table(t)), async () => {
      for (const t of BACKUP_TABLES) {
        // Older backups never had camera set-ups: keep this device's.
        if (t === 'cameraSetups' && data.tables[t] === undefined) continue;
        let rows = ((data.tables[t] ?? []) as object[]).map(decodeBlobs);
        if (t === 'settings') {
          rows = rows.map((r) => {
            const clean = withoutSecrets(r as NotifyRow);
            if (!clean.notify) return clean;
            const own = current?.notify ? Object.fromEntries(SECRET_FIELDS.map((k) => [k, (current.notify as Record<string, unknown>)[k]])) : {};
            const notify = { ...clean.notify, ...own };
            if ((r as { flags?: { notifications?: boolean } }).flags?.notifications && !SECRET_FIELDS.some((k) => notify[k])) messagesNeedSetup = true;
            return { ...clean, notify };
          });
        }
        await database.table(t).clear();
        if (rows.length) await database.table(t).bulkAdd(rows);
        counts[t] = rows.length;
      }
      await ensureRoomProfile(database);
    });
  } catch (e) {
    return { ok: false, error: `The backup could not be restored (${e instanceof Error ? e.message : String(e)}); nothing was changed.` };
  }
  return { ok: true, counts, messagesNeedSetup };
}

/** A backup from before room profiles (format 1) gets one made from its room measurements, as the schema migration does. */
export async function ensureRoomProfile(database: TrainingDB): Promise<void> {
  if ((await database.roomProfiles.count()) > 0) return;
  const last = await database.layouts.orderBy('version').last();
  if (!last) return;
  await database.roomProfiles.put(profileFromLegacyLayout(last, new Date().toISOString()));
  const s = await database.settings.get('main');
  if (s) await database.settings.put({ ...s, activeRoomProfileId: 'room-1' });
}

export function backupFileName(date = new Date()): string {
  return `home-training-backup-${date.toISOString().slice(0, 10)}.json`;
}
