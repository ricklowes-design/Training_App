import { logHistory, useData } from '../app/data';
import { db } from '../db/db';
import { listText, missingFor, turnOnPatch } from '../domain/needs';
import type { RunBlock } from '../domain/plans';

/** "This drill uses … which are off": one tap turns them on (parent request 2026-10-29). Nothing shows when all are on. */
export function TurnOnNeeded({ blocks, what = 'This drill' }: { blocks: RunBlock[]; what?: string }) {
  const { programme: p, settings, roomProfile } = useData();
  const off = missingFor(p, blocks, settings, roomProfile?.wallUsable);
  if (!off.length) return null;
  async function turnOn() {
    await db.settings.update('main', turnOnPatch(off, settings));
    await logHistory('parent', 'switches', `turned on for ${what.toLowerCase()}: ${listText(off)}`);
  }
  return (
    <div className="note-box row spread" data-testid="turn-on-needed">
      <span>
        {what} uses {listText(off)}: {off.length > 1 ? 'they are' : 'it is'} off.
      </span>
      <button className="btn go" onClick={turnOn}>
        Turn {off.length > 1 ? 'them' : 'it'} on
      </button>
    </div>
  );
}
