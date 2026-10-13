// Shared primitives.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { shortHex } from '../lib/format.ts';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative rounded-2xl border border-line bg-surface/80 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const styles: Record<string, string> = {
    primary:
      'bg-nova text-ground font-semibold hover:brightness-110 disabled:bg-line disabled:text-ink-faint',
    ghost:
      'border border-line-bright text-ink hover:border-aurora hover:text-aurora disabled:text-ink-faint disabled:hover:border-line-bright',
    danger: 'border border-danger/40 text-danger hover:bg-danger/10',
  };
  return (
    <button
      {...props}
      className={`rounded-xl px-5 py-3 text-sm transition disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-dim">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-2 block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-ink outline-none transition placeholder:text-ink-faint focus:border-aurora ${className}`}
    />
  );
}

export function Digest({ value, label }: { value: string; label?: string }) {
  return (
    <button
      type="button"
      title={`${value} — click to copy`}
      onClick={() => void navigator.clipboard?.writeText(value)}
      className="group inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-mono text-xs text-ink-dim transition hover:border-aurora hover:text-aurora"
    >
      {label ? <span className="text-ink-faint">{label}</span> : null}
      {shortHex(value)}
      <span className="opacity-0 transition group-hover:opacity-100">copy</span>
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'aurora' | 'nova' | 'danger';
}) {
  const tones: Record<string, string> = {
    neutral: 'border-line text-ink-dim',
    aurora: 'border-aurora/40 text-aurora',
    nova: 'border-nova/40 text-nova',
    danger: 'border-danger/40 text-danger',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * States a fact about what the chain can and cannot see.
 *
 * Used liberally: a privacy product that does not say precisely what it hides
 * is asking to be taken on faith, and the whole point is that it does not have
 * to be.
 */
export function PrivacyNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-xs leading-relaxed text-ink-faint">
      <span className="mt-[3px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-aurora" />
      <span>{children}</span>
    </p>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
      {children}
    </div>
  );
}

/**
 * A row of mutually exclusive choices, with the selected one's explanation shown
 * beneath. Used where a choice changes what the contract does, so the consequence
 * is stated next to the control rather than hidden in a tooltip.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <div>
      <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-ink-dim">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-1 rounded-2xl border border-line bg-surface-2 p-1"
      >
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
              o.value === value
                ? 'bg-nova text-ground shadow-lg shadow-nova/20'
                : 'text-ink-dim hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {selected?.hint ? <p className="mt-2 text-xs text-ink-faint">{selected.hint}</p> : null}
    </div>
  );
}

/**
 * The title block at the top of every working page: a serif headline with one
 * italic phrase in the accent colour, and a line of explanation beneath.
 */
export function PageHeader({
  title,
  accent,
  after,
  children,
}: {
  title: string;
  accent: string;
  /** Text that follows the accent phrase on the same line. */
  after?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8 text-center">
      <h1 className="font-display text-5xl tracking-tight sm:text-6xl">
        {title} <em className="text-aurora">{accent}</em>
        {after ? ` ${after}` : ''}
      </h1>
      {children ? (
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-dim">{children}</p>
      ) : null}
    </div>
  );
}
