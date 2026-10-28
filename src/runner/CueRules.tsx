import type { Programme } from '../content/types';
import { cueDrillFor } from '../cue/resolve';
import type { RunBlock } from '../domain/plans';

// What the screen will show in a cue block and what to do for each (content: cueDrills[].values and
// .rule, and the drill that teaches it). General rules only: nothing here tells which side is right on a rep.

export function cueRuleLine(p: Programme, block: RunBlock): string | null {
  const c = cueDrillFor(p, block);
  return c?.rule ? `${c.values!.join(' · ')}: ${c.rule}` : null;
}

export function CueRules({ p, block }: { p: Programme; block: RunBlock }) {
  const c = cueDrillFor(p, block);
  if (!c) return null;
  // The drill this block runs, or (for tests and anchors) the drill that teaches this cue.
  const own = p.drills.find((d) => d.id === block.drillId && d.cueDrillId === c.id);
  const anchorDrill = block.anchorId ? p.drills.find((d) => d.id === p.anchors.find((a) => a.id === block.anchorId)?.drillId) : undefined;
  const teaching = own ?? anchorDrill ?? p.drills.find((d) => d.cueDrillId === c.id);
  const how = c.howTo;
  return (
    <div className="note-box stack" data-testid="cue-rules" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}>How to do it</h2>
      {teaching?.steps?.length ? (
        <ol className="cue-steps" data-testid="cue-steps">
          {teaching.steps.map((st) => (
            <li key={st}>{st}</li>
          ))}
        </ol>
      ) : teaching ? (
        <p>{teaching.prescription}</p>
      ) : null}
      {how?.expect ? (
        <p>
          <strong>What you will see:</strong> {how.expect}
        </p>
      ) : null}
      <table className="data cue-words">
        <tbody>
          {c.values!.map((v) => (
            <tr key={v}>
              <td>
                <span className="pill info" style={{ fontSize: '1.1rem', whiteSpace: 'nowrap' }}>
                  {v}
                </span>
              </td>
              <td>{how?.words[v] ?? c.rule}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The short spoken version, said with the countdown ("Walk to the start …"). */
export function cueSayLine(p: Programme, block: RunBlock): string | undefined {
  return cueDrillFor(p, block)?.howTo?.say;
}
