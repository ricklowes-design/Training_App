// Block-level chance model for decision tasks (task 4.3, part 16 §5). With balanced,
// unpredictable cues, guessing among k outcomes is right with probability 1/k on each rep.
// The tail probability is a group-level clue that choices beat guessing; it is never
// proof that any single rep involved a scan.

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** P(X ≥ correct) for X ~ Binomial(n, 1/k). */
export function chanceTail(correct: number, n: number, k: number): number {
  if (n <= 0 || k < 2) return 1;
  const p = 1 / k;
  let t = 0;
  for (let x = Math.max(0, correct); x <= n; x++) t += Math.exp(logChoose(n, x) + x * Math.log(p) + (n - x) * Math.log(1 - p));
  return Math.min(1, t);
}

/** Percent for display: one decimal under 1%, whole numbers otherwise. */
export const chancePct = (p: number) => (p < 0.01 ? (Math.round(p * 1000) / 10).toString() : Math.round(p * 100).toString());
