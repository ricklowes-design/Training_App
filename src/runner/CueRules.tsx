import type { Programme } from '../content/types';
import { cueDrillFor } from '../cue/resolve';
import type { RunBlock } from '../domain/plans';

// What the screen will show in a cue block and what to do for each (content: cueDrills[].values and
// .rule, and the drill that teaches it). General rules only: nothing here tells which side is right on a rep.

export function cueRuleLine(p: Programme, block: RunBlock): string | null {
  const c = cueDrillFor(p, block);
  return c?.rule ? `${c.values!.join(' · ')}: ${c.rule}` : null;
}

export function CueRules({ p, block, wall }: { p: Programme; block: RunBlock; wall?: boolean }) {
  const c = cueDrillFor(p, block);
  if (!c) return null;
  // The drill this block runs, or (for tests and anchors) the drill that teaches this cue.
  const own = p.drills.find((d) => d.id === block.drillId && d.cueDrillId === c.id);
  const anchorDrill = block.anchorId ? p.drills.find((d) => d.id === p.anchors.find((a) => a.id === block.anchorId)?.drillId) : undefined;
  const teaching = own ?? anchorDrill ?? p.drills.find((d) => d.cueDrillId === c.id);
  const how = c.howTo;
  // With a wall: kick at the wall, the cue comes on the bounce.
  const steps = (wall && teaching?.stepsWall) || teaching?.steps;
  return (
    <div className="howto" data-testid="cue-rules">
      {how?.why ? (
        <p className="howto-why" data-testid="cue-why">
          <strong>Why:</strong> {how.why}
        </p>
      ) : null}
      {steps?.length ? (
        <ol className="howto-steps" data-testid="cue-steps">
          {steps.map((st) => (
            <li key={st}>{st}</li>
          ))}
        </ol>
      ) : teaching ? (
        <p className="howto-why">{teaching.prescription}</p>
      ) : null}
      <div className="howto-words">
        {c.values!.map((v) => (
          <div key={v} className="howto-word">
            <span className="pill info">{v}</span>
            <span>{how?.words[v] ?? c.rule}</span>
          </div>
        ))}
      </div>
      {how?.expect ? <p className="muted">{how.expect}</p> : null}
    </div>
  );
}

/** The short spoken version, said with the countdown ("Walk to the start …"). */
export function cueSayLine(p: Programme, block: RunBlock): string | undefined {
  return cueDrillFor(p, block)?.howTo?.say;
}

/** What the voice reads out before a drill: why, the steps, and what each word means (or, for drills
 *  without cues, the purpose and what to do). */
export function talkThrough(p: Programme, block: RunBlock, title: string, wall?: boolean): string {
  const c = cueDrillFor(p, block);
  const drill = p.drills.find((d) => d.id === block.drillId);
  const parts: string[] = [`${title}.`];
  if (c) {
    const anchorDrill = block.anchorId ? p.drills.find((d) => d.id === p.anchors.find((a) => a.id === block.anchorId)?.drillId) : undefined;
    const teaching = (drill?.cueDrillId === c.id ? drill : undefined) ?? anchorDrill ?? p.drills.find((d) => d.cueDrillId === c.id);
    const steps = (wall && teaching?.stepsWall) || teaching?.steps || [];
    if (c.howTo?.why) parts.push(`Why: ${c.howTo.why}`);
    parts.push(...steps.map((st, i) => `${i + 1}. ${st}`));
    for (const v of c.values ?? []) if (c.howTo?.words[v]) parts.push(`${v}: ${c.howTo.words[v]}`);
  } else if (drill) {
    parts.push(drill.purpose.endsWith('.') ? drill.purpose : `${drill.purpose}.`);
    parts.push(...(drill.steps ?? [drill.prescription]));
  }
  return parts.join(' ');
}

