import { useEffect, useRef, useState } from 'react';
import { say, tone } from '../audio/audio';
import type { Quiz } from '../content/types';

// Practice-view variants that the app runs itself: timed slalom runs with a
// tap-to-finish target, head-up digits, and the no-ball picture quiz.

const DIGIT_EVERY_MS = 1500;
const randomDigit = (prev?: number) => {
  let d = Math.floor(Math.random() * 10);
  if (d === prev) d = (d + 1 + Math.floor(Math.random() * 9)) % 10;
  return d;
};

/** Big digit changing every 1.5 s, for head-up work (D4, DB-head-up). Records the sequence. */
export function DigitFlasher({ onDigit, size = '60vh' }: { onDigit?: (d: number) => void; size?: string }) {
  const [digit, setDigit] = useState<number>(() => randomDigit());
  const cb = useRef(onDigit);
  cb.current = onDigit;
  useEffect(() => {
    cb.current?.(digit);
    const t = setInterval(() => {
      setDigit((prev) => {
        const d = randomDigit(prev);
        cb.current?.(d);
        return d;
      });
    }, DIGIT_EVERY_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div style={{ fontSize: size, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{digit}</div>;
}

type RunStage = { side: 'right' | 'left'; phase: 'ready' | 'running' }[];

/** Slalom down and back, both patterns: start on the tone, finish by tapping anywhere on the big target. */
export function TimedRuns(props: { headUp: boolean; onFinished: (times: { right: number; left: number }, digits: number[]) => void; readyS?: number }) {
  const { headUp, onFinished, readyS = 8 } = props;
  const order: RunStage = [
    { side: 'right', phase: 'ready' },
    { side: 'left', phase: 'ready' },
  ];
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'ready' | 'running'>('ready');
  const [startAt, setStartAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [times, setTimes] = useState<{ right?: number; left?: number }>({});
  const digits = useRef<number[]>([]);
  const readyAt = useRef(Date.now());
  const side = order[idx]?.side;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!side) return;
    readyAt.current = Date.now();
    say(`Pattern ${side === 'right' ? 'R' : 'L'}. Start on the tone.`);
  }, [side]);

  useEffect(() => {
    if (phase !== 'ready' || !side) return;
    const left = readyS - (now - readyAt.current) / 1000;
    if (left <= 0) {
      tone('start');
      setStartAt(Date.now());
      setPhase('running');
    }
  }, [now, phase, side, readyS]);

  const finish = () => {
    if (phase !== 'running' || !side) return;
    const t = Math.round((Date.now() - startAt) / 100) / 10;
    tone('end');
    const nextTimes = { ...times, [side]: t };
    setTimes(nextTimes);
    if (idx + 1 < order.length) {
      setIdx(idx + 1);
      setPhase('ready');
    } else {
      onFinished({ right: nextTimes.right ?? 0, left: nextTimes.left ?? 0 }, digits.current);
    }
  };

  if (!side) return null;
  if (phase === 'ready') {
    const left = Math.max(0, Math.ceil(readyS - (now - readyAt.current) / 1000));
    return (
      <div className="practice countdown">
        <div className="drill">Pattern {side === 'right' ? 'R' : 'L'}</div>
        <div className="clock">{left}</div>
        <div className="sub">Go on the tone. Finish by tapping the screen.</div>
        <div />
      </div>
    );
  }
  const elapsed = (now - startAt) / 1000;
  return (
    <button className="finish-target" onClick={finish} aria-label="Finish">
      {headUp ? <DigitFlasher onDigit={(d) => digits.current.push(d)} size="50vh" /> : <div className="mono">{elapsed.toFixed(1)}</div>}
      <div style={{ fontSize: '8vh' }}>FINISH — tap anywhere</div>
    </button>
  );
}

/** One receiving situation: the defender's side decides the correct first touch. */
interface QuizItem {
  pressure: 'left' | 'right' | 'both';
  answer: string;
}

function makeItems(n: number, options: string[]): QuizItem[] {
  const [left, right, back] = options; // e.g. LEFT RIGHT BACK
  return Array.from({ length: n }, () => {
    const r = Math.random();
    const pressure = r < 0.4 ? 'left' : r < 0.8 ? 'right' : 'both';
    return { pressure, answer: pressure === 'left' ? right : pressure === 'right' ? left : back };
  });
}

function QuizPicture({ item }: { item: QuizItem }) {
  // Top-down: player at the bottom centre receiving, ball arriving from below; defenders marked X.
  const defender = (x: number) => (
    <g key={x}>
      <line x1={x - 18} y1={60} x2={x + 18} y2={96} stroke="#ff5c5c" strokeWidth={10} />
      <line x1={x + 18} y1={60} x2={x - 18} y2={96} stroke="#ff5c5c" strokeWidth={10} />
    </g>
  );
  return (
    <svg className="quiz-pitch" viewBox="0 0 400 300" role="img" aria-label="Receiving situation">
      <rect x={0} y={0} width={400} height={300} fill="#0d3b1e" rx={12} />
      <line x1={0} y1={150} x2={400} y2={150} stroke="#2f6b43" strokeWidth={3} />
      {item.pressure !== 'right' ? defender(110) : null}
      {item.pressure !== 'left' ? defender(290) : null}
      <circle cx={200} cy={190} r={22} fill="#5cb8ff" />
      <circle cx={200} cy={262} r={12} fill="#fff" />
      <line x1={200} y1={250} x2={200} y2={215} stroke="#fff" strokeWidth={4} strokeDasharray="6 6" />
    </svg>
  );
}

/** No-ball picture quiz: tap the first-touch direction within the time limit. */
export function PictureQuiz({ quiz, onDone }: { quiz: Quiz; onDone: (correct: number, outOf: number) => void }) {
  const [items] = useState(() => makeItems(quiz.items, quiz.options));
  const [i, setI] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [shownAt, setShownAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const advance = (gotIt: boolean) => {
    const c = correct + (gotIt ? 1 : 0);
    setCorrect(c);
    if (i + 1 >= items.length) onDone(c, items.length);
    else {
      setI(i + 1);
      setShownAt(Date.now());
    }
  };

  useEffect(() => {
    if (i < items.length && now - shownAt > quiz.answerS * 1000) {
      tone('tick');
      advance(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const item = items[i];
  if (!item) return null;
  return (
    <div className="practice">
      <div className="meta">
        Picture {i + 1} of {items.length} · {Math.max(0, quiz.answerS - (now - shownAt) / 1000).toFixed(1)} s
      </div>
      <div>
        <QuizPicture item={item} />
      </div>
      <div className="quiz-answers">
        {quiz.options.map((o) => (
          <button key={o} className="btn xl" onClick={() => advance(o === item.answer)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
