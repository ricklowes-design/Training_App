import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { rec } from '../test/factories';
import { decodeBlobs, encodeBlobs, ensureRoomProfile } from './backup';
import { TrainingDB } from './db';

/** The schema an earlier app version left on the device (versions 1 and 2). */
function legacy(name: string): Dexie {
  const old = new Dexie(name);
  old.version(1).stores({
    settings: 'id',
    player: 'id',
    layouts: 'version',
    sessionRecords: 'id, runId, kind, areaId, date',
    benchmarkResults: 'id, sessionRecordId, benchmarkId, date',
    placements: 'areaId',
    overrides: '++id, date',
    customDrills: 'id',
    coachNotes: '++id, date',
    transferObs: '++id, areaId',
    advancements: '++id, areaId',
    extraCriteria: '++id, areaId',
    milestones: 'id',
    demoClips: 'drillId',
    problemReports: '++id, date',
    history: '++id, date',
  });
  old.version(2).stores({ cueDrills: 'id', cameraSetups: '++id, drillFamily', clips: 'id, date, sessionRecordId', repAnalyses: 'id, clipId', blockAnalyses: 'id, clipId' });
  return old;
}

const layout = { version: 2, createdAt: '2026-01-01', roomLengthM: 6.1, roomWidthM: 3, floor: 'hard', wallUsable: false, cones: 12, derived: {} };

describe('schema 2 → 3 migration (part 16 §10)', () => {
  it('keeps every earlier record and makes a room profile from the room measurements', async () => {
    const old = legacy('mig-1');
    await old.open();
    await old.table('settings').put({ id: 'main', firstRunDone: true });
    await old.table('layouts').put(layout);
    await old.table('sessionRecords').bulkPut([rec({ id: 'a', areaId: 'scanning', sessionNumber: 1 }), rec({ id: 'b', areaId: 'feinting', sessionNumber: 3, trial: true })]);
    await old.table('benchmarkResults').put({ id: 'r', sessionRecordId: 'a', benchmarkId: 'SB', date: '2026-01-02', values: { kind: 'SB', correct: 8 } });
    await old.table('coachNotes').add({ date: '2026-01-03', author: 'coach', target: { kind: 'drill', id: 'F3' }, body: 'note' });
    old.close();

    const db = new TrainingDB('mig-1');
    await db.open();
    expect(db.verno).toBe(3);
    expect(await db.sessionRecords.count()).toBe(2);
    expect((await db.sessionRecords.get('b'))?.trial).toBe(true);
    expect((await db.benchmarkResults.get('r'))?.values).toEqual({ kind: 'SB', correct: 8 });
    expect(await db.coachNotes.count()).toBe(1);
    const p = await db.roomProfiles.get('room-1');
    expect(p?.usableSpaceClass).toBe('standard');
    expect(p?.approxUsableM).toEqual({ length: 6.1, width: 3 });
    expect(p?.scaleSource).toBe('migratedRoomDimensions');
    expect((await db.settings.get('main'))?.activeRoomProfileId).toBe('room-1');
    for (const t of ['layoutInstances', 'metricObservations', 'defenderScenarios', 'feintReps', 'scanReps', 'ballProfiles', 'modelVersions', 'learningExamples']) expect(await db.table(t).count()).toBe(0);
    db.close();
  });

  it('a device that never finished set-up migrates without a profile', async () => {
    const old = legacy('mig-2');
    await old.open();
    old.close();
    const db = new TrainingDB('mig-2');
    await db.open();
    expect(await db.roomProfiles.count()).toBe(0);
    db.close();
  });

  it('an old backup without room profiles gets one on restore', async () => {
    const db = new TrainingDB('mig-3');
    await db.layouts.put(layout as never);
    await db.settings.put({ id: 'main' } as never);
    await ensureRoomProfile(db);
    expect((await db.roomProfiles.get('room-1'))?.name).toBe('Main room');
    await ensureRoomProfile(db); // idempotent
    expect(await db.roomProfiles.count()).toBe(1);
  });

  it('room photos survive the JSON backup as base64', async () => {
    const row = { id: 'p', backgroundFrame: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' }) };
    const enc = JSON.parse(JSON.stringify(await encodeBlobs(row)));
    const dec = decodeBlobs(enc) as { backgroundFrame: Blob };
    expect(dec.backgroundFrame.type).toBe('image/jpeg');
    expect([...new Uint8Array(await dec.backgroundFrame.arrayBuffer())]).toEqual([1, 2, 3, 250]);
  });
});
