// All feedback text comes from the content's feedbackTemplates (plan/05 §5.5).
// fill() refuses to produce text with a missing value, so nothing is made up.

export class TemplateError extends Error {}

export function fill(templates: Record<string, string>, key: string, vars: Record<string, string | number>): string {
  const t = templates[key];
  if (t === undefined) throw new TemplateError(`No feedback template "${key}"`);
  return t.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null || v === '') throw new TemplateError(`Template "${key}" needs a value for {${name}}`);
    return String(v);
  });
}

/** Fill, or return null when the template or a value is missing (for optional lines). */
export function tryFill(templates: Record<string, string>, key: string, vars: Record<string, string | number>): string | null {
  try {
    return fill(templates, key, vars);
  } catch {
    return null;
  }
}

/** Words that must never appear in generated feedback (plan/05 §5.5). */
export const BANNED_PHRASES = ['great job', 'keep the streak', "you're behind", 'make it up', 'sold it', 'catch up', 'streak', 'fooled the defender', 'deception quality'];
