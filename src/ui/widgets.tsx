import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionStatus } from '../db/types';

export function Stepper({ label, value, onChange, min = 0, max = 99, step = 1, suffix }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <div className="stepper">
      <span className="lbl">{label}</span>
      <button type="button" aria-label={`${label} down`} onClick={() => onChange(clamp(value - step))}>−</button>
      <span className="val">
        {step < 1 ? value.toFixed(1) : value}
        {suffix ? <small> {suffix}</small> : null}
      </span>
      <button type="button" aria-label={`${label} up`} onClick={() => onChange(clamp(value + step))}>+</button>
    </div>
  );
}

export function Seg<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button type="button" key={String(o.value)} className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const STATUS_TEXT: Record<SessionStatus, string> = {
  completed: 'completed',
  completedBenchmarkSkipped: 'completed, benchmark skipped',
  partial: 'partial',
  stopped: 'stopped — not counted',
};

export function StatusPill({ status, trial }: { status: SessionStatus; trial?: boolean }) {
  const cls = status === 'completed' || status === 'completedBenchmarkSkipped' ? 'go' : status === 'partial' ? 'warn' : 'stop';
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <span className={`pill ${cls}`}>{STATUS_TEXT[status]}</span>
      {trial ? <span className="pill trial">trial</span> : null}
    </span>
  );
}

export const statusText = (s: SessionStatus) => STATUS_TEXT[s];

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Date(iso).toLocaleDateString(undefined, opts);
}

export function fmtClock(totalS: number): string {
  const s = Math.max(0, Math.ceil(totalS));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function downloadText(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}

/** A button that acts only after being held (default 0.8 s), so a stray tap cannot end a session (audit task 13).
 *  Enter or Space on the focused button acts at once (keyboard users). The accessible name stays `label`. */
export function HoldButton({ ms = 800, onHold, className = 'btn', label, hint = 'hold' }: { ms?: number; onHold: () => void; className?: string; label: string; hint?: string }) {
  const timer = useRef<number | undefined>(undefined);
  const [holding, setHolding] = useState(false);
  const cancel = () => {
    setHolding(false);
    window.clearTimeout(timer.current);
  };
  return (
    <button
      type="button"
      aria-label={label}
      className={`${className} hold-btn${holding ? ' holding' : ''}`}
      style={{ ['--hold-ms' as string]: `${ms}ms` }}
      onPointerDown={() => {
        setHolding(true);
        timer.current = window.setTimeout(() => {
          setHolding(false);
          onHold();
        }, ms);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onHold();
        }
      }}
    >
      {label} <span className="hold-hint">· {hint}</span>
    </button>
  );
}
