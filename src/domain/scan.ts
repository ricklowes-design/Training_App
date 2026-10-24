import type { Drill, Programme, ScanMode } from '../content/types';
import type { RoomProfile } from '../db/types';

/** Which scanning mode a block runs (part 15 D9): the second-change version where the session asks for it,
 *  the wall rebound when the room profile has a usable wall, otherwise the stationary-ball receiving simulation. */
export function scanModeFor(p: Programme, drill: Drill | undefined, params: string | undefined, room: RoomProfile | undefined): ScanMode | undefined {
  if (!drill?.scanModes?.length) return undefined;
  const pick = (id: string) => p.scanModes.find((m) => m.id === id);
  if (/second information change/i.test(params ?? '')) return pick('secondChange');
  if (drill.scanModes.includes('rebound') && room?.wallUsable) return pick('rebound');
  return pick('stationarySimulation');
}
