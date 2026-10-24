import { profileFromLegacyLayout } from '../domain/room';
import { BACKUP_TABLES, type BackupTable, type TrainingDB } from './db';

export const BACKUP_FORMAT = 'home-training-backup';
export const BACKUP_FORMAT_VERSION = 2;

type EncodedBlob = { __blob: string; type: string };

const toBase64 = (buf: ArrayBuffer): string => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Blob fields (room photos, ball thumbnails) become base64 so the backup stays one JSON file. */
export async function encodeBlobs(row: object): Promise<object> {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out)) if (v instanceof Blob) out[k] = { __blob: toBase64(await v.arrayBuffer()), type: v.type } satisfies EncodedBlob;
  return out;
}

export function decodeBlobs(row: object): object {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (v && typeof v === 'object' && '__blob' in v) {
      const e = v as EncodedBlob;
      out[k] = new Blob([Uint8Array.from(atob(e.__blob), (c) => c.charCodeAt(0))], { type: e.type });
    }
  }
  return out;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  tables: Partial<Record<BackupTable, unknown[]>>;
}

export async function exportBackup(database: TrainingDB, appVersion: string): Promise<Backup> {
  const tables: Backup['tables'] = {};
  const raw: Partial<Record<BackupTable, object[]>> = {};
  await database.transaction('r', BACKUP_TABLES.map((t) => database.table(t)), async () => {
    for (const t of BACKUP_TABLES) raw[t] = await database.table(t).toArray();
  });
  for (const t of BACKUP_TABLES) tables[t] = await Promise.all((raw[t] ?? []).map(encodeBlobs));
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), appVersion, tables };
}

export type ImportResult = { ok: true; counts: Record<string, number> } | { ok: false; error: string };

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
  }
  const counts: Record<string, number> = {};
  await database.transaction('rw', BACKUP_TABLES.map((t) => database.table(t)), async () => {
    for (const t of BACKUP_TABLES) {
      const rows = ((data.tables[t] ?? []) as object[]).map(decodeBlobs);
      await database.table(t).clear();
      if (rows.length) await database.table(t).bulkAdd(rows);
      counts[t] = rows.length;
    }
  });
  await ensureRoomProfile(database);
  return { ok: true, counts };
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
