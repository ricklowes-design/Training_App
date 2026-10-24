import type { CueView } from './engine';

const ARROWS: Record<string, string> = { LEFT: 'M90 50 L40 50 M60 25 L35 50 L60 75', RIGHT: 'M10 50 L60 50 M40 25 L65 50 L40 75', UP: 'M50 90 L50 35 M25 55 L50 30 L75 55' };
const WORD_COLOURS: Record<string, string> = {
  BIT: '#0b8f3a',
  GO: '#0b8f3a',
  HELD: '#c77700',
  BLOCKED: '#b3261e',
  'BEHIND BLOCKED': '#b3261e',
  'FRONT BLOCKED': '#b3261e',
  'BOTH BLOCKED': '#b3261e',
  'LEFT FREE': '#0b5fa5',
  'RIGHT FREE': '#0b5fa5',
};
const COLOURS: Record<string, string> = { RED: '#d32f2f', BLUE: '#1565c0', YELLOW: '#f9c80e', GREEN: '#2e7d32' };

function Arrow({ dir, size = '60vh' }: { dir: string; size?: string }) {
  return (
    <svg viewBox="0 0 100 100" style={{ height: size, width: size }} aria-label={dir}>
      <path d={ARROWS[dir]} stroke="#fff" strokeWidth={11} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Full-screen cue: arrows at least a third of the screen height, words and numbers as large as fit. */
export function CueDisplay({ view, waiting }: { view: CueView | null; waiting?: string }) {
  if (!view) {
    return (
      <div className="cue-screen" style={{ background: '#000' }}>
        <div className="sub">{waiting ?? ''}</div>
      </div>
    );
  }
  const { value, number, side } = view;
  if (COLOURS[value]) {
    return (
      <div className="cue-screen" style={{ background: COLOURS[value] }}>
        <div className="cue-word" style={{ color: value === 'YELLOW' ? '#111' : '#fff' }}>
          {value}
        </div>
      </div>
    );
  }
  if (ARROWS[value]) {
    return (
      <div className="cue-screen" style={{ background: '#0b3d91' }}>
        <div className="row" style={{ justifyContent: 'center', gap: '4vw' }}>
          <Arrow dir={value} />
          {number !== undefined ? <div className="cue-number">{number}</div> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="cue-screen" style={{ background: WORD_COLOURS[value] ?? '#333' }}>
      <div className="row" style={{ justifyContent: 'center', gap: '3vw' }}>
        {side ? <Arrow dir={side === 'left' ? 'LEFT' : 'RIGHT'} size="40vh" /> : null}
        <div className="cue-word" style={{ fontSize: value.length > 8 ? '15vh' : '26vh' }}>
          {value}
        </div>
        {number !== undefined ? <div className="cue-number">{number}</div> : null}
      </div>
    </div>
  );
}
