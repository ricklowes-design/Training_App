import type { Programme } from './types';
import { parseProgramme } from './validate';

export type ContentLoad = { ok: true; programme: Programme } | { ok: false; errors: string[] };

export async function loadProgrammeFile(url = './content/programme.json'): Promise<ContentLoad> {
  let text: string;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return { ok: false, errors: [`Could not load the content file (${res.status} ${res.statusText}).`] };
    text = await res.text();
  } catch (err) {
    return { ok: false, errors: [`Could not load the content file: ${err instanceof Error ? err.message : String(err)}`] };
  }
  return parseProgramme(text);
}
