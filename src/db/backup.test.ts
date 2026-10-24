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
