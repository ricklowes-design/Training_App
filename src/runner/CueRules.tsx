import type { Programme } from '../content/types';
import { cueDrillFor } from '../cue/resolve';
import type { RunBlock } from '../domain/plans';
import type { ResolvedTeaching } from '../domain/trainingMode';

// What the player is told before a block, for the way it will actually run (Brief R01): the 3D defender
// (how to read it), its word/arrow fallback (labelled), a cue drill, an anchor, or a plain drill with its
// own teaching. General rules only: nothing here tells which side is right on a rep.

export function cueRuleLine(p: Programme, block: RunBlock): string | null {
  const c = cueDrillFor(p, block);
  return c?.rule ? `${c.values!.join(' · ')}: ${c.rule}` : null;
}

export function CueRules({ t }: { t: ResolvedTeaching | null }) {
  // A plain drill without its own teaching keeps the purpose/set-up/do panel only.
  if (!t || (t.mode === 'plain' && !t.success)) return null;
  return (
    <div className="howto" data-testid="cue-rules" data-mode={t.mode}>
      {t.label ? (
        <p className="note-box" data-testid="mode-label">
          {t.label}
        </p>
      ) : null}
      {t.why ? (
        <p className="howto-why" data-testid="cue-why">
          <strong>Why:</strong> {t.why}
        </p>
      ) : null}
      {t.steps.length ? (
        <ol className="howto-steps" data-testid="cue-steps">
          {t.steps.map((st) => (
            <li key={st}>{st}</li>
          ))}
        </ol>
      ) : null}
      {t.read?.length ? (
        <ul className="howto-read" data-testid="defender-read">
          {t.read.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {t.words?.length ? (
        <div className="howto-words">
          {t.words.map((w) => (
            <div key={w.value} className="howto-word">
              <span className="pill info">{w.value}</span>
              <span>{w.meaning}</span>
            </div>
          ))}
        </div>
      ) : null}
      {t.expect ? <p className="muted">{t.expect}</p> : null}
      {t.success ? (
        <p className="muted" data-testid="teach-success">
          <strong>Done well:</strong> {t.success} <strong>Watch for:</strong> {t.commonError}
        </p>
      ) : null}
    </div>
  );
}

/** What the voice reads out before a drill: why, the steps, how to read the defender or what each word
 *  means, from the same resolved teaching as the screen. Plain drills without teaching: purpose and steps. */
export function talkThrough(p: Programme, block: RunBlock, title: string, t: ResolvedTeaching | null): string {
  const parts: string[] = [`${title}.`];
  if (t && !(t.mode === 'plain' && !t.success)) {
    if (t.label) parts.push(t.label);
    if (t.why) parts.push(`Why: ${t.why}`);
    parts.push(...t.steps.map((st, i) => `${i + 1}. ${st}`));
    if (t.read) parts.push(...t.read);
    for (const w of t.words ?? []) if (w.meaning) parts.push(`${w.value}: ${w.meaning}`);
  } else {
    const drill = p.drills.find((d) => d.id === block.drillId);
    if (drill) {
      parts.push(drill.purpose.endsWith('.') ? drill.purpose : `${drill.purpose}.`);
      parts.push(...(drill.steps ?? [drill.prescription]));
    }
  }
  return parts.join(' ');
}
