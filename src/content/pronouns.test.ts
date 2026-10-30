import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The app's words never assume the player's gender (audit task 14, Brief R15). Stored zone ids such as
// "left gate (her left)" in src/camera/geometry.ts are data names kept for saved camera set-ups.
const ALLOWED = /her[- ](left|right)/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|json)$/.test(f) ? [p] : [];
  });
}

describe('no gendered wording', () => {
  it('UI text, content and comments use "the player"', () => {
    const hits: string[] = [];
    for (const f of [...files('src'), 'content/programme.json']) {
      if (f.endsWith('pronouns.test.ts')) continue;
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\b(she|her|hers|herself)\b/i.test(line.replace(new RegExp(ALLOWED, 'gi'), ''))) hits.push(`${f}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
