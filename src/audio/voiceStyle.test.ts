import { describe, expect, it } from 'vitest';
import { loadProgramme } from '../test/fixtures';
import { styledLine } from './audio';

const coach = loadProgramme().voiceStyles!.touchline;

describe('touchline coach voice', () => {
  it('says the standard lines its own way, keeping the facts', () => {
    expect(styledLine('Half way.', coach)).toBe('Halfway! Keep it going!');
    expect(styledLine('Thirty seconds.', coach)).toBe('Thirty seconds! Come on, sharp now!');
    expect(styledLine('Slalom close control in 10 seconds. Walk to the start. Stand behind the first cone.', coach)).toBe(
      'Right! Slalom close control in 10. Get to your start, quick! Stand behind the first cone.',
    );
    expect(styledLine('Rest. Next: Scissors.', coach)).toBe('Get your breath back. Next: Scissors.');
  });

  it('leaves anything it has no line for unchanged, and the standard style changes nothing', () => {
    expect(styledLine('Left exit.', coach)).toBe('Left exit.');
    expect(styledLine('Half way.', undefined)).toBe('Half way.');
  });

  it('never says anything negative', () => {
    for (const l of coach.lines) expect(l.say).not.toMatch(/useless|rubbish|lazy|terrible|pathetic|bad|stupid/i);
  });
});
