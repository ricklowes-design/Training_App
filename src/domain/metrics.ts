import type { BenchmarkValues } from '../db/types';
import { tryFill } from './templates';

/** One line of a result, in the drill's own units. A time always carries its error count. */
export interface ResultLine {
  key: string;
  label: string;
  text: string;
  score?: number; // higher is better
  timeS?: number; // lower is better; always paired with errors
  errors?: number;
  extra?: number; // e.g. digits /8, higher is better
}

const s1 = (x: number) => x.toFixed(1);
const fbSide = (x: { sell: number; exit: number; eyes: number }) => x.sell + x.exit + x.eyes;

export function resultLines(v: BenchmarkValues): ResultLine[] {
  switch (v.kind) {
    case 'SB':
      return [{ key: 'correct', label: 'Decisions', text: `${v.correct}/10${v.scans !== undefined ? ` · scans ${v.scans}/10` : ''}`, score: v.correct }];
    case 'FB':
      return (['right', 'left'] as const).map((side) => {
        const x = v[side];
        return {
          key: side,
          label: side === 'right' ? 'Right exits' : 'Left exits',
          text: `${fbSide(x)}/30 (fake ${x.sell}, exit ${x.exit}, eyes ${x.eyes})`,
          score: fbSide(x),
        };
      });
    case 'DB':
    case 'A1':
      return (['right', 'left'] as const).map((side) => {
        const x = v[side] as { timeS: number; errors: number; digits?: number };
        const digits = x.digits !== undefined ? ` · digits ${x.digits}/8` : '';
        return {
          key: side,
          label: side === 'right' ? 'Pattern R' : 'Pattern L',
          text: `${s1(x.timeS)} s · ${x.errors} err${digits}`,
          timeS: x.timeS,
          errors: x.errors,
          extra: x.digits,
        };
      });
    case 'CB':
      return [
        { key: 'cb2', label: 'Gate test', text: `${v.cb2.right + v.cb2.left}/10 (R ${v.cb2.right}/5 · L ${v.cb2.left}/5)`, score: v.cb2.right + v.cb2.left },
        { key: 'cb1r', label: 'V-pulls right', text: `${v.cb1.right} in 30 s`, score: v.cb1.right },
        { key: 'cb1l', label: 'V-pulls left', text: `${v.cb1.left} in 30 s`, score: v.cb1.left },
      ];
    case 'CA':
      return [{ key: 'correct', label: 'Cue accuracy', text: `${v.correct}/${v.outOf}`, score: v.correct }];
    case 'A2':
      return [{ key: 'gate', label: 'Gate test', text: `R ${v.right}/5 · L ${v.left}/5`, score: v.right + v.left }];
    case 'A3':
      return [
        {
          key: 'correct',
          label: 'Arrow exits',
          text: `${v.correct}/16 · ${v.early} possible early`,
          score: v.correct,
        },
      ];
    case 'A4':
      return [{ key: 'correct', label: 'Decisions', text: `${v.correct}/10${v.looks !== undefined ? ` · looks ${v.looks}/10` : ''}`, score: v.correct }];
    case 'QUIZ':
      return [{ key: 'correct', label: 'Picture quiz', text: `${v.correct}/${v.outOf}`, score: v.correct }];
  }
}

export function resultText(v: BenchmarkValues): string {
  return resultLines(v)
    .map((l) => `${l.label} ${l.text}`)
    .join(' · ');
}

export type LineVerdict = 'improvement' | 'fasterMoreErrors' | 'result';

export function compareLine(now: ResultLine, before: ResultLine): LineVerdict {
  if (now.timeS !== undefined && before.timeS !== undefined) {
    const faster = now.timeS < before.timeS;
    const moreErrors = (now.errors ?? 0) > (before.errors ?? 0);
    const fewerDigits = now.extra !== undefined && before.extra !== undefined && now.extra < before.extra;
    if (faster && moreErrors) return 'fasterMoreErrors';
    if (faster && !moreErrors && !fewerDigits) return 'improvement';
    return 'result';
  }
  if (now.score !== undefined && before.score !== undefined && now.score > before.score) return 'improvement';
  return 'result';
}

/** One sentence per line, from the templates. Never calls a faster time with more errors an improvement. */
export function comparisonSentences(
  templates: Record<string, string>,
  name: string,
  now: BenchmarkValues,
  before: BenchmarkValues | undefined,
  sameConditions: boolean,
): string[] {
  const nowLines = resultLines(now);
  if (!before || !sameConditions) {
    return nowLines.map((l) => tryFill(templates, 'firstResult', { metric: `${name} ${l.label}`, now: l.text })).filter((x): x is string => !!x);
  }
  const beforeLines = resultLines(before);
  return nowLines
    .map((l) => {
      const b = beforeLines.find((x) => x.key === l.key);
      const metric = `${name} ${l.label}`;
      if (!b) return tryFill(templates, 'firstResult', { metric, now: l.text });
      const verdict = compareLine(l, b);
      if (verdict === 'fasterMoreErrors') {
        return tryFill(templates, 'fasterMoreErrors', { metric, time: `${s1(l.timeS!)} s`, errors: l.errors!, ptime: `${s1(b.timeS!)} s`, perrors: b.errors!, diff: l.errors! - b.errors! });
      }
      if (verdict === 'improvement') return tryFill(templates, 'improvement', { metric, now: l.text, before: b.text });
      return tryFill(templates, 'result', { metric, now: l.text, before: b.text });
    })
    .filter((x): x is string => !!x);
}

/** Single numbers used by the advancement rules (plan/03 criteria). Undefined when not applicable. */
export function metricValue(v: BenchmarkValues, metric: string): number | undefined {
  switch (v.kind) {
    case 'SB':
    case 'CA':
      return metric === 'correct' ? v.correct : undefined;
    case 'FB': {
      const l = fbSide(v.left);
      const r = fbSide(v.right);
      if (metric === 'total') return l + r;
      if (metric === 'leftPctOfRight') return r === 0 ? 0 : (100 * l) / r;
      return undefined;
    }
    case 'DB': {
      if (metric === 'maxErrors') return Math.max(v.left.errors, v.right.errors);
      if (metric === 'minDigits') return v.left.digits === undefined || v.right.digits === undefined ? undefined : Math.min(v.left.digits, v.right.digits);
      if (metric === 'leftTimeOverRightPct') return v.right.timeS === 0 ? undefined : (100 * (v.left.timeS - v.right.timeS)) / v.right.timeS;
      return undefined;
    }
    case 'CB': {
      if (metric === 'cb2Total') return v.cb2.left + v.cb2.right;
      if (metric === 'cb2Left') return v.cb2.left;
      if (metric === 'cb1LeftPctOfRight') return v.cb1.right === 0 ? 0 : (100 * v.cb1.left) / v.cb1.right;
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Left-foot parity (milestone: left ≥ 80% of right), where the benchmark has a left/right split. */
export function leftPctOfRight(v: BenchmarkValues): number | undefined {
  if (v.kind === 'FB') return metricValue(v, 'leftPctOfRight');
  if (v.kind === 'CB') return v.cb2.right === 0 ? undefined : (100 * v.cb2.left) / v.cb2.right;
  if (v.kind === 'A2') return v.right === 0 ? undefined : (100 * v.left) / v.right;
  return undefined;
}
