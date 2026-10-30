import { describe, expect, it } from 'vitest';
import type { CameraSetup, RoomProfile, Settings } from '../db/types';
import { loadProgramme } from '../test/fixtures';
import { readiness } from './readiness';

const p = loadProgramme();
const s = (enabled: boolean, validations = {}) => ({ camera: { enabled }, validations }) as unknown as Pick<Settings, 'camera' | 'validations'>;
const room = {} as RoomProfile;
const setup = {} as CameraSetup;

describe('parent readiness overview (Brief R06)', () => {
  it('no room: training needs the room set-up, and says where', () => {
    const [t] = readiness(p, s(false), undefined, []);
    expect(t).toMatchObject({ state: 'needsAction', fix: { section: 'room' } });
  });
  it('camera off: recording and measures are optional, training still ready', () => {
    const r = readiness(p, s(false), room, []);
    expect(r.map((x) => x.state)).toEqual(['ready', 'optional', 'optional']);
  });
  it('camera on without a set-up needs one; with a set-up, recording is ready but never called validated', () => {
    expect(readiness(p, s(true), room, [])[1]).toMatchObject({ state: 'needsAction', fix: { section: 'camera' } });
    const r = readiness(p, s(true), room, [setup]);
    expect(r[1].state).toBe('ready');
    expect(r[1].text).toContain('not the same as validated');
    expect(r[2].state).toBe('needsAction');
  });
});
