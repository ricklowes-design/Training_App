import type { DrillTeaching, Programme } from '../content/types';
import { cueDrillFor } from '../cue/resolve';
import { defenderWillShow } from '../defender/resolve';
import type { Settings } from '../db/types';
import type { RunBlock } from './plans';

// One resolved training mode per block (Brief R01): the instructions, the spoken talk-through, the
// countdown line, the demonstration choice and the stored block all describe what the player will
// actually see and do. A fallback is named as a fallback and teaches its own cue.

export type TrainingMode = 'defender3d' | 'cueFallback' | 'cue' | 'anchorFixed' | 'plain';

export interface ResolvedTeaching {
  mode: TrainingMode;
  /** Shown above the steps when the block runs differently from its usual form. */
  label?: string;
  why?: string;
  steps: string[];
  /** How to read the opponent (3D defender mode only); never which way is right on a rep. */
  read?: string[];
  /** Screen words and what each asks (cue modes only). */
  words?: { value: string; meaning: string }[];
  expect?: string;
  success?: string;
  commonError?: string;
  easier?: string;
  harder?: string;
  /** The short line said with the countdown. */
  say?: string;
  /** Content version + mode, stored with the block so the result can be read later. */
  version: string;
}

const FALLBACK_LABEL = 'The 3D defender is not used on this Chromebook today, so the screen shows a word or arrow instead.';

function fromTeach(t: DrillTeaching): Pick<ResolvedTeaching, 'why' | 'steps' | 'read' | 'success' | 'commonError' | 'easier' | 'harder'> {
  return { why: t.why, steps: t.steps, read: t.read, success: t.success, commonError: t.commonError, easier: t.easier, harder: t.harder };
}

export function resolveTraining(p: Programme, block: RunBlock, settings: Pick<Settings, 'flags' | 'capabilities'>, wall?: boolean): ResolvedTeaching | null {
  const c = cueDrillFor(p, block);
  const own = p.drills.find((d) => d.id === block.drillId);
  const anchorDrill = block.anchorId ? p.drills.find((d) => d.id === p.anchors.find((a) => a.id === block.anchorId)?.drillId) : undefined;
  const version = (mode: TrainingMode) => `${p.version}:${mode}`;
  const cueWords = () => (c?.values ?? []).map((v) => ({ value: v, meaning: c?.howTo?.words[v] ?? c?.rule ?? '' }));

  // A defender drill: the 3D defender when it will show, otherwise its word/arrow fallback, labelled.
  if (block.kind === 'work' && own?.defenderDrillId) {
    if (defenderWillShow(p, block, settings) && own.teach?.defender3d) {
      const t = own.teach.defender3d;
      return { mode: 'defender3d', ...fromTeach(t), say: t.steps[t.steps.length - 1], version: version('defender3d') };
    }
    const t = own.teach?.cue;
    const steps = (wall && own.stepsWall) || t?.steps || own.steps || [own.prescription];
    return { mode: 'cueFallback', label: FALLBACK_LABEL, ...(t ? fromTeach(t) : { why: c?.howTo?.why }), steps, words: c ? cueWords() : undefined, expect: c?.howTo?.expect, say: c?.howTo?.say, version: version('cueFallback') };
  }

  if (c) {
    // The drill this block runs, or (for tests and anchors) the drill that teaches this cue.
    const teaching = (own?.cueDrillId === c.id ? own : undefined) ?? anchorDrill ?? p.drills.find((d) => d.cueDrillId === c.id);
    const t = teaching?.teach?.cue;
    const steps = (wall && teaching?.stepsWall) || t?.steps || teaching?.steps || (teaching ? [teaching.prescription] : []);
    const mode: TrainingMode = block.kind === 'anchor' ? 'anchorFixed' : 'cue';
    return { mode, ...(t ? fromTeach(t) : {}), why: c.howTo?.why ?? t?.why, steps, words: cueWords(), expect: c.howTo?.expect, say: c.howTo?.say, version: version(mode) };
  }

  const drill = own ?? anchorDrill;
  if (!drill) return null;
  const t = drill.teach?.plain;
  if (t) return { mode: 'plain', ...fromTeach(t), version: version('plain') };
  return { mode: 'plain', why: drill.purpose, steps: drill.steps ?? [drill.prescription], version: version('plain') };
}
