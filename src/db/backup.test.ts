import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { rec } from '../test/factories';
import { exportBackup, importBackup } from './backup';
import { TrainingDB } from './db';

describe('backup', () => {
  it('export → clear → import brings everything back', async () => {
    const db = new TrainingDB('test-backup');
    await db.sessionRecords.put(rec({ id: 'r1', areaId: 'scanning', sessionNumber: 1 }));
    await db.coachNotes.add({ date: '2026-01-12', author: 'coach via parent', target: { kind: 'drill', id: 'F3' }, body: 'Smaller scissors' });
    await db.settings.put({ id: 'main' } as never);
    const backup = await exportBackup(db, '0.1.0');
    const text = JSON.stringify(backup);
    await Promise.all(db.tables.map((t) => t.clear()));
    expect(await db.sessionRecords.count()).toBe(0);
    const r = await importBackup(db, text);
    expect(r.ok).toBe(true);
    expect((await db.sessionRecords.get('r1'))?.sessionNumber).toBe(1);
    expect((await db.coachNotes.toArray())[0].body).toBe('Smaller scissors');
  });

  it('rejects files that are not backups, without touching data', async () => {
    const db = new TrainingDB('test-backup-2');
    await db.sessionRecords.put(rec({ id: 'keep' }));
    expect((await importBackup(db, '{"hello":1}')).ok).toBe(false);
    expect((await importBackup(db, 'not json')).ok).toBe(false);
    expect(await db.sessionRecords.count()).toBe(1);
  });
});

describe('backup completeness and secrets (audit task 10, Brief R05)', () => {
  const settingsRow = (notify: Record<string, unknown>) => ({ id: 'main', flags: { notifications: true }, notify }) as never;

  it('a floor map image nested in a room profile survives as a Blob of the same size', async () => {
    const db = new TrainingDB('test-backup-3');
    const image = new Blob([new Uint8Array(1234)], { type: 'image/png' });
    await db.roomProfiles.put({ id: 'room-1', floorMap: { points: [], image, pxPerM: 80, fitErrorM: 0.1, createdAt: 'x' } } as never);
    const text = JSON.stringify(await exportBackup(db, '0.1.0'));
    await db.roomProfiles.clear();
    expect((await importBackup(db, text)).ok).toBe(true);
    const back = (await db.roomProfiles.get('room-1')) as unknown as { floorMap: { image: Blob } };
    expect(back.floorMap.image).toBeInstanceOf(Blob);
    expect(back.floorMap.image.size).toBe(1234);
  });

  it('camera set-ups are backed up; an older backup without them keeps the device’s set-ups', async () => {
    const db = new TrainingDB('test-backup-4');
    await db.cameraSetups.add({ drillFamily: 'L2', deviceId: 'd', deviceLabel: 'USB', referenceFrame: new Blob(['jpg']), width: 1, height: 1, zones: [], floorPoints: [], mirror: false, createdAt: 'x' });
    const b = await exportBackup(db, '0.1.0');
    expect(b.tables.cameraSetups).toHaveLength(1);
    const old = { ...b, formatVersion: 2, tables: { ...b.tables } };
    delete old.tables.cameraSetups;
    expect((await importBackup(db, JSON.stringify(old))).ok).toBe(true);
    expect(await db.cameraSetups.count()).toBe(1);
  });

  it('the exported file holds no session-message link or token, and the live settings keep them', async () => {
    const db = new TrainingDB('test-backup-5');
    await db.settings.put(settingsRow({ channel: 'discord', webhookUrl: 'https://discord.com/api/webhooks/1/secret-abc', telegramToken: '123:fake-token-aaaaaaaaaaaaaaaaaaaa', queue: [{ id: 'q' }] }));
    const text = JSON.stringify(await exportBackup(db, '0.1.0'));
    expect(text).not.toContain('secret-abc');
    expect(text).not.toContain('fake-token');
    expect((await db.settings.get('main'))?.notify?.webhookUrl).toContain('secret-abc');
  });

  it('import keeps this device’s token, never takes one from the file, and says when messages need setting up', async () => {
    const db = new TrainingDB('test-backup-6');
    // An old-format file that still contains a credential.
    const file = { format: 'home-training-backup', formatVersion: 2, exportedAt: 'x', appVersion: '0', tables: { settings: [settingsRow({ channel: 'discord', webhookUrl: 'https://discord.com/api/webhooks/1/from-file' })] } };
    await db.settings.put(settingsRow({ channel: 'discord', webhookUrl: 'https://discord.com/api/webhooks/1/on-device' }));
    expect((await importBackup(db, JSON.stringify(file))).ok).toBe(true);
    expect((await db.settings.get('main'))?.notify?.webhookUrl).toContain('on-device');
    // A fresh device: nothing comes from the file, and the restore says messages need their link.
    const fresh = new TrainingDB('test-backup-7');
    const r = await importBackup(fresh, JSON.stringify(file));
    expect(r.ok && r.messagesNeedSetup).toBe(true);
    expect((await fresh.settings.get('main'))?.notify?.webhookUrl).toBeUndefined();
  });

  it('a failed restore leaves the existing tables unchanged', async () => {
    const db = new TrainingDB('test-backup-8');
    await db.sessionRecords.put(rec({ id: 'keep' }));
    const bad = { format: 'home-training-backup', formatVersion: 3, exportedAt: 'x', appVersion: '0', tables: { sessionRecords: [rec({ id: 'a' }), rec({ id: 'a' })] } };
    const r = await importBackup(db, JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nothing was changed/);
    expect((await db.sessionRecords.toArray()).map((x) => x.id)).toEqual(['keep']);
  });
});
