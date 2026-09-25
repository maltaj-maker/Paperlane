'use client';

/**
 * Quantity stepper.
 *
 * Mobile-first: big minus/plus targets either side of a numeric field, sized so
 * a thumb can hit them one-handed. The input is a real `<input type="number">`
 * (with `inputMode`) so typing an exact quantity and using browser/spinner
 * accessibility both work.
 *
 * Constraints come from the server (available stock, per-order cap). The stepper
 * refuses to exceed them and tells the customer why, rather than letting them
 * reach checkout with an unfulfillable basket.
 */

import * as React from 'react';
import { cn } from '@/lib/cn';

export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Shown when the customer hits `max`. */
  maxReason?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
  /** Fires once when the customer tries to exceed `max`. */
  onMaxReached?: () => void;
}

const SIZES = {
  sm: { btn: 'h-8 w-8 min-h-8', input: 'h-8 w-10 text-sm', icon: 'h-3 w-3' },
  md: { btn: 'h-10 w-10 min-h-10', input: 'h-10 w-12 text-base', icon: 'h-3.5 w-3.5' },
  lg: { btn: 'h-12 w-12 min-h-12', input: 'h-12 w-14 text-lg', icon: 'h-4 w-4' },
};

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  maxReason,
  disabled,
  size = 'md',
  className,
  label = 'Quantity',
  onMaxReached,
}: QuantityStepperProps) {
  const [draft, setDraft] = React.useState(String(value));
  const [touchedMax, setTouchedMax] = React.useState(false);
  const styles = SIZES[size];

  // Keep the text field in sync when the parent clamps the value.
  React.useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    if (parsed > max) {
      setTouchedMax(true);
      onMaxReached?.();
      onChange(max);
      setDraft(String(max));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    onChange(clamped);
    setDraft(String(clamped));
  };

  const step = (delta: number) => {
    const next = value + delta;
    if (next > max) {
      setTouchedMax(true);
      onMaxReached?.();
      return;
    }
    const clamped = Math.max(min, Math.min(max, next));
    if (clamped !== value) onChange(clamped);
    setDraft(String(clamped));
  };

  return (
    <div className={cn('inline-flex flex-col gap-1', className)}>
      <div
        className={cn(
          'inline-flex items-center rounded-full border border-line bg-paper',
          disabled && 'opacity-50',
        )}
      >
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={disabled || value <= min}
          aria-label="Decrease quantity"
          className={cn(
            'flex items-center justify-center rounded-l-full text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-40',
            styles.btn,
          )}
        >
          <svg className={styles.icon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <input
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          min={min}
          max={max}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit((event.target as HTMLInputElement).value);
            }
          }}
          className={cn(
            'border-x border-line bg-transparent text-center font-medium tabular-nums text-ink focus:outline-none focus-visible:bg-paper-soft disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden',
            styles.input,
          )}
        />

        <button
          type="button"
          onClick={() => step(1)}
          disabled={disabled || value >= max}
          aria-label="Increase quantity"
          className={cn(
            'flex items-center justify-center rounded-r-full text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-40',
            styles.btn,
          )}
        >
          <svg className={styles.icon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Announced politely so the message does not interrupt mid-typing. */}
      {(touchedMax || value >= max) && maxReason && (
        <p role="status" className="text-xs text-warning">
          {maxReason}
        </p>
      )}
    </div>
  );
}
