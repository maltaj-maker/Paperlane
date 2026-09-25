/**
 * Star rating — display and interactive input.
 *
 * Accessibility notes, because star widgets are one of the most commonly broken
 * controls on the web:
 *  - Display mode exposes a single accessible label ("4.3 out of 5, 128
 *    ratings") rather than five meaningless icons.
 *  - Input mode is a real radiogroup with native radio inputs, so arrow keys,
 *    screen readers and form autofill all behave.
 *  - The visual star and the accessible name are kept in sync, so what a
 *    sighted user sees matches what a screen-reader user hears.
 */

import * as React from 'react';
import { cn } from '@/lib/cn';

function Star({ fill, className }: { fill: number; className?: string }) {
  // Rendered as two stacked paths: an outline, and a clipped filled copy.
  const clipId = React.useId();
  const percent = Math.max(0, Math.min(1, fill)) * 100;

  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={`${percent}%`} height="24" />
        </clipPath>
      </defs>
      <path
        d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.5 9.5l6.6-.9 2.9-6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        className="text-ink-faint"
      />
      <path
        d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.5 9.5l6.6-.9 2.9-6z"
        fill="currentColor"
        clipPath={`url(#${clipId})`}
        className="text-accent"
      />
    </svg>
  );
}

export interface RatingProps {
  value: number;
  count?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Hide the numeric value, e.g. inside a dense card. */
  showValue?: boolean;
  /** Link the whole widget to the reviews section. */
  href?: string;
}

export function Rating({ value, count, size = 'md', className, showValue = true, href }: RatingProps) {
  const stars = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  const safeValue = Math.max(0, Math.min(5, value || 0));

  const label = count !== undefined
    ? `Rated ${safeValue.toFixed(1)} out of 5 from ${count} ${count === 1 ? 'rating' : 'ratings'}`
    : `Rated ${safeValue.toFixed(1)} out of 5`;

  const content = (
    <>
      <span className="flex items-center gap-px" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <Star key={index} fill={Math.max(0, Math.min(1, safeValue - index))} className={stars} />
        ))}
      </span>

      {showValue && safeValue > 0 && (
        <span className="text-xs font-medium text-ink-soft tabular-nums" aria-hidden="true">
          {safeValue.toFixed(1)}
        </span>
      )}

      {count !== undefined && (
        <span className="text-xs text-ink-muted tabular-nums" aria-hidden="true">
          ({count})
        </span>
      )}

      <span className="sr-only">{label}</span>
    </>
  );

  const classes = cn('inline-flex items-center gap-1.5', className);

  if (href) {
    return (
      <a href={href} className={cn(classes, 'hover:opacity-80')}>
        {content}
      </a>
    );
  }

  return <span className={classes}>{content}</span>;
}

export interface RatingInputProps {
  name: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
  required?: boolean;
  className?: string;
}

/**
 * Interactive rating picker with a live text description of the chosen value.
 * Using radios (rather than clickable divs) means this works with no JavaScript
 * for the semantics, and every assistive technology already understands it.
 */
export function RatingInput({ name, value, onChange, error, required, className }: RatingInputProps) {
  const [hover, setHover] = React.useState<number | null>(null);
  const groupId = React.useId();
  const shown = hover ?? value;

  const DESCRIPTIONS: Record<number, string> = {
    1: 'Did not finish it',
    2: 'It was okay',
    3: 'A good read',
    4: 'Really enjoyed it',
    5: 'Loved it — recommending it to everyone',
  };

  return (
    <fieldset
      className={cn('w-full', className)}
      aria-describedby={error ? `${groupId}-error` : undefined}
      onMouseLeave={() => setHover(null)}
    >
      <legend className="mb-1.5 text-sm font-medium text-ink">
        Your rating
        {required && (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </legend>

      <div className="flex items-center gap-1" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((star) => (
          <label
            key={star}
            className="cursor-pointer rounded p-1.5 transition-transform hover:scale-110"
            onMouseEnter={() => setHover(star)}
            onFocus={() => setHover(star)}
            onBlur={() => setHover(null)}
          >
            <input
              type="radio"
              name={name}
              value={star}
              checked={value === star}
              onChange={() => onChange(star)}
              className="sr-only"
              aria-label={`${star} ${star === 1 ? 'star' : 'stars'} — ${DESCRIPTIONS[star]}`}
            />
            <span aria-hidden="true">
              <Star fill={shown >= star ? 1 : 0} className={cn('h-7 w-7 transition-colors', shown >= star ? 'text-accent' : 'text-ink-faint')} />
            </span>
          </label>
        ))}

        <span className="ml-2 text-sm text-ink-muted" aria-hidden="true">
          {shown > 0 ? DESCRIPTIONS[shown] : 'Tap to rate'}
        </span>
      </div>

      {error && (
        <p id={`${groupId}-error`} role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Compact histogram used on the reviews tab of a product page. */
export function RatingBreakdown({
  distribution,
  total,
  average,
}: {
  distribution: Array<{ stars: number; count: number; percent: number }>;
  total: number;
  average: number;
}) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
      <div className="flex shrink-0 flex-col items-center gap-1 sm:w-32">
        <span className="font-display text-4xl font-semibold leading-none text-ink">{average.toFixed(1)}</span>
        <Rating value={average} size="sm" showValue={false} />
        <span className="text-xs text-ink-muted">
          {total} {total === 1 ? 'rating' : 'ratings'}
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        {distribution.map((row) => (
          <div key={row.stars} className="flex items-center gap-3">
            <span className="w-8 shrink-0 text-xs text-ink-muted tabular-nums">{row.stars}★</span>
            <div
              className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-sunken"
              role="img"
              aria-label={`${row.count} ${row.count === 1 ? 'rating' : 'ratings'} at ${row.stars} ${row.stars === 1 ? 'star' : 'stars'}`}
            >
              <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out-soft" style={{ width: `${row.percent}%` }} />
            </div>
            <span className="w-9 shrink-0 text-right text-xs text-ink-muted tabular-nums">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
