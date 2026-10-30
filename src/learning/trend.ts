// Trends and spaced review (task 7.6, part 18). A trend needs enough comparable points; the
// criteria are shown with it so a recommendation can explain what it rests on.

export type TrendDirection = 'improving' | 'stable' | 'deteriorating' | 'insufficient';

export const MIN_POINTS = 4;

/** Least-squares slope per point index, judged against the spread of the values. */
export function trend(values: number[], higherIsBetter = true): { trend: TrendDirection; slope?: number; n: number } {
  const n = values.length;
  if (n < MIN_POINTS) return { trend: 'insufficient', n };
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * (values[i] - my);
    sxx += (i - mx) ** 2;
  }
  const slope = sxy / sxx;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - my) ** 2, 0) / n) || 1;
  const signed = higherIsBetter ? slope : -slope;
  // The fitted change over the window must exceed the spread of the values.
  const t: TrendDirection = signed * (n - 1) > sd ? 'improving' : signed * (n - 1) < -sd ? 'deteriorating' : 'stable';
  return { trend: t, slope, n };
}

/** Mastered areas due a short review: stage confirmed beyond the first and not practised for `days`. */
export function reviewDue(lastPractised: string | undefined, mastered: boolean, now: Date, days = 14): boolean {
  if (!mastered) return false;
  if (!lastPractised) return true;
  return (now.getTime() - new Date(lastPractised).getTime()) / 86_400_000 >= days;
}
