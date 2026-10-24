import type { CueLogEntry } from '../cue/engine';
import type { DefenderScenario } from '../db/types';

export type DefenderLogEntry = CueLogEntry & { reaction: string; triggerMs: number };

/** Defender reps as the analysis' rep log: the "cue" is the moment the defender's move became visible,
 *  and the expected action is the one that is right against its final position. */
export function scenariosToLog(scen: DefenderScenario[]): DefenderLogEntry[] {
  return [...scen]
    .sort((a, b) => a.repIndex - b.repIndex)
    .map((s) => {
      const at = (st: string) => s.cueEvents.find((e) => e.state === st)?.atMs;
      const repStartMs = at('repStart') ?? 0;
      return {
        rep: s.repIndex,
        repStartMs,
        trigger: 'timed',
        cueMs: at('reaction'),
        value: s.correctExit === 'left' ? 'LEFT' : s.correctExit === 'right' ? 'RIGHT' : 'SECOND',
        plannedDelayMs: 0,
        reaction: s.reaction,
        triggerMs: at('trigger') ?? repStartMs,
      };
    });
}
