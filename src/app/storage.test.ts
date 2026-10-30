import { describe, expect, it } from 'vitest';
import { isQuota, saveFailedText } from './storage';

describe('save failures (audit 2026-10-29, task 8)', () => {
  it('recognises a full disk directly and wrapped by Dexie', () => {
    expect(isQuota(Object.assign(new Error('full'), { name: 'QuotaExceededError' }))).toBe(true);
    expect(isQuota(Object.assign(new Error('Dexie'), { name: 'AbortError', inner: Object.assign(new Error('x'), { name: 'QuotaExceededError' }) }))).toBe(true);
    expect(isQuota(new Error('other'))).toBe(false);
    expect(isQuota('text')).toBe(false);
  });

  it('says what to do, and that nothing is lost while the screen stays open', () => {
    expect(saveFailedText(Object.assign(new Error('full'), { name: 'QuotaExceededError' }))).toMatch(/^The Chromebook has no room left/);
    expect(saveFailedText(new Error('locked'))).toBe('This session could not be saved yet (locked). Tap Try again. Nothing is lost while this screen stays open.');
  });
});
