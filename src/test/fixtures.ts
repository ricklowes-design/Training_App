import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Programme } from '../content/types';

export const programmeText = (): string => readFileSync(resolve(__dirname, '../../content/programme.json'), 'utf8');
export const loadProgramme = (): Programme => JSON.parse(programmeText()) as Programme;
