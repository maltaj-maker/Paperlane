/**
 * Price display.
 *
 * Formatting goes through the same money helpers the server uses, so a price can
 * never render differently in two places. The component also owns the "was /
 * now / save" layout because getting that hierarchy wrong is how shops end up
 * looking like a discount bin.
 */

import { cn } from '@/lib/cn';
import { formatPaise } from '@/lib/money';

export interface PriceProps {
  pricePaise: number;
  salePricePaise?: number | null;
  /** Printed MRP, shown struck through when a discount applies. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Shows "Save ₹X (Y%)" beside the price. */
  showSaving?: boolean;
  /** Tax note under the price, e.g. "Inclusive of all taxes". */
  taxNote?: string;
}

const SIZES = {
  sm: { now: 'text-sm font-semibold', was: 'text-xs', note: 'text-2xs' },
  md: { now: 'text-base font-semibold', was: 'text-sm', note: 'text-xs' },
  lg: { now: 'text-xl font-semibold', was: 'text-sm', note: 'text-xs' },
  xl: { now: 'text-3xl font-semibold tracking-tight', was: 'text-base', note: 'text-xs' },
};

export function Price({
  pricePaise,
  salePricePaise,
  size = 'md',
  className,
  showSaving = false,
  taxNote,
}: PriceProps) {
  const hasSale = salePricePaise !== null && salePricePaise !== undefined && salePricePaise > 0 && salePricePaise < pricePaise;
  const current = hasSale ? salePricePaise : pricePaise;
  const styles = SIZES[size];
  const saved = hasSale ? pricePaise - salePricePaise : 0;
  const percent = hasSale && pricePaise > 0 ? Math.round((saved / pricePaise) * 100) : 0;

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={cn(styles.now, 'text-ink whitespace-nowrap')}>{formatPaise(current)}</span>

        {hasSale && (
          <>
            <span className={cn(styles.was, 'text-ink-faint line-through whitespace-nowrap')}>
              {formatPaise(pricePaise)}
            </span>
            <span className="sr-only">
              reduced from {formatPaise(pricePaise)}
            </span>
          </>
        )}
      </div>

      {showSaving && hasSale && (
        <span className={cn(styles.note, 'font-medium text-success')}>
          Save {formatPaise(saved)} ({percent}% off)
        </span>
      )}

      {taxNote && <span className={cn(styles.note, 'text-ink-faint')}>{taxNote}</span>}
    </div>
  );
}

/** Corner badge for card artwork: "-25%" or "New". */
export function PriceBadge({
  percent,
  label,
  tone = 'accent',
  className,
}: {
  percent?: number;
  label?: string;
  tone?: 'accent' | 'danger' | 'success' | 'ink';
  className?: string;
}) {
  const text = label ?? (percent ? `${percent}% off` : null);
  if (!text) return null;

  const tones = {
    accent: 'bg-accent text-white',
    danger: 'bg-danger text-white',
    success: 'bg-success text-white',
    ink: 'bg-ink text-paper',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-1 text-2xs font-bold uppercase tracking-wide shadow-sm',
        tones[tone],
        className,
      )}
    >
      {text}
    </span>
  );
}
