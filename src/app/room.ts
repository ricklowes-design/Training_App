import type { Programme } from '../content/types';
import { db } from '../db/db';
import type { RoomProfile, Settings } from '../db/types';
import { layoutForProfile, layoutFromProfile, profileChanged, profileClass } from '../domain/room';
import { logHistory } from './data';

/** Saves a room profile: a new version when something meaningful changed, the class re-derived,
 *  and a new layout version when the drill geometry changes. Makes it the active profile. */
export async function saveRoomProfile(next: RoomProfile, p: Programme, settings: Settings): Promise<{ profile: RoomProfile; layoutVersion: number; newLayout: boolean }> {
  const prev = await db.roomProfiles.get(next.id);
  const now = new Date().toISOString();
  const usableSpaceClass = profileClass(next);
  let profile: RoomProfile = { ...next, usableSpaceClass, updatedAt: now };
  if (prev && profileChanged(prev, profile)) profile = { ...profile, version: prev.version + 1 };
  await db.roomProfiles.put(profile);
  if (settings.activeRoomProfileId !== profile.id) await db.settings.update('main', { activeRoomProfileId: profile.id });
  const all = await db.layouts.toArray();
  const current = layoutForProfile(all, profile.id);
  const layout = layoutFromProfile(profile, current, settings.equipment.cones, p.layoutGeometry, new Date(), Math.max(0, ...all.map((l) => l.version)) + 1);
  if (layout) await db.layouts.put(layout);
  if (!prev || profile.version !== prev.version || layout) {
    await logHistory('parent', 'room profile', `${profile.name} v${profile.version}: ${usableSpaceClass}${layout ? `, drill geometry → layout v${layout.version}` : ''}`);
  }
  return { profile, layoutVersion: layout?.version ?? current?.version ?? 0, newLayout: !!layout };
}

/** Switching rooms: the chosen profile's geometry becomes the current layout. */
export async function useRoomProfile(id: string, p: Programme, settings: Settings): Promise<number> {
  const prof = await db.roomProfiles.get(id);
  if (!prof) return 0;
  await db.settings.update('main', { activeRoomProfileId: id });
  const all = await db.layouts.toArray();
  const current = layoutForProfile(all, id);
  const layout = layoutFromProfile(prof, current, settings.equipment.cones, p.layoutGeometry, new Date(), Math.max(0, ...all.map((l) => l.version)) + 1);
  if (layout) await db.layouts.put(layout);
  await logHistory('parent', 'room profile', `Using ${prof.name} v${prof.version}${layout ? ` (layout v${layout.version})` : ''}`);
  return layout?.version ?? current?.version ?? 0;
}
