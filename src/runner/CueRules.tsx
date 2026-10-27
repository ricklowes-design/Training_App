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
  // The drill that teaches this cue, for its step-by-step "Do" (benchmarks and anchors name only the cue drill).
  const teaching = p.drills.find((d) => d.cueDrillId === c.id && d.id === block.drillId) ?? p.drills.find((d) => d.cueDrillId === c.id);
  return (
    <div className="note-box stack" data-testid="cue-rules" style={{ gap: 6 }}>
      <strong>What the screen will show</strong>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {c.values!.map((v) => (
          <span key={v} className="pill info" style={{ fontSize: '1.1rem' }}>
            {v}
          </span>
        ))}
      </div>
      {c.rule ? (
        <div>
          <strong>What to do:</strong> {c.rule}
        </div>
      ) : null}
      {teaching && teaching.id !== block.drillId ? (
        <div className="muted">
          How ({teaching.id} · {teaching.name}): {teaching.prescription}
        </div>
      ) : null}
    </div>
  );
}
