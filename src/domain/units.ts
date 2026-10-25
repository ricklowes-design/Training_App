// Length display in the parent's chosen units. Everything is stored in metres; feet and inches
// are only for showing and entering lengths.

export type Units = 'metric' | 'imperial';
const INCH = 0.0254;

/** "1.2 m", or "3 ft 11 in" / "8 in". Metres to 0.1 m (centimetres below 1 m are not meaningful here). */
export function fmtLen(m: number, units: Units = 'metric'): string {
  if (units === 'metric') return `${Number(m.toFixed(m < 1 ? 2 : 1))} m`;
  const total = Math.round(m / INCH);
  const ft = Math.floor(total / 12);
  const inch = total % 12;
  if (!ft) return `${inch} in`;
  return inch ? `${ft} ft ${inch} in` : `${ft} ft`;
}

/** Feet and whole inches for an input pair. */
export function toFtIn(m: number): { ft: number; inch: number } {
  const total = Math.round(m / INCH);
  return { ft: Math.floor(total / 12), inch: total % 12 };
}

export function fromFtIn(ft: number, inch: number): number {
  return Number(((ft * 12 + inch) * INCH).toFixed(3));
}

/** Converts the metre lengths written in programme text ("1.5 m square", "6 × 3 m") for display. */
export function localiseText(text: string, units: Units = 'metric'): string {
  if (units === 'metric' || !text) return text;
  return text
    .replace(/(\d+(?:\.\d+)?)\s?×\s?(\d+(?:\.\d+)?)\s?m\b(?!\/)/g, (_, a, b) => `${fmtLen(Number(a), units)} × ${fmtLen(Number(b), units)}`)
    .replace(/(\d+(?:\.\d+)?)\s?m\b(?!\/)/g, (_, a) => fmtLen(Number(a), units));
}
