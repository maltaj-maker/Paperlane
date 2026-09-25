import Link from 'next/link';

import { env } from '@/lib/env';
import { cn } from '@/lib/cn';

/**
 * Wordmark.
 *
 * Drawn as text with a deliberate typographic treatment rather than shipped as
 * an image: it scales perfectly, stays legible at 20px in the header, needs no
 * extra request, and can invert for dark mode. The small rules either side are
 * the shop's only concession to decoration — a bookseller's mark, not a logo.
 */
export function Wordmark({
  showTagline = false,
  size = 'md',
  asLink = true,
  showTagline = false,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  asLink?: boolean;
  /** Adds the one-line description beneath the name. Footer use only. */
  showTagline?: boolean;
  className?: string;
}) {
  const name = env().APP_NAME;

  const sizing =
    size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl';

  const mark = (
    <span className={cn('inline-flex items-baseline gap-2 font-display font-semibold tracking-tight', sizing)}>
      <span className="text-ink">{name}</span>
      <span className="hidden h-px w-6 self-center bg-accent sm:block" aria-hidden="true" />
    </span>
  );

  const content = showTagline ? (
    <span className={cn('inline-flex flex-col', className)}>
      {mark}
      <span className="mt-1.5 text-xs uppercase tracking-[0.18em] text-ink-faint">
        Independent booksellers
      </span>
    </span>
  ) : (
    <span className={className}>{mark}</span>
  );

  if (!asLink) return content;

  return (
    <Link href="/" aria-label={`${name} — home`} className="inline-flex shrink-0 items-center rounded-sm">
      {content}
    </Link>
  );
}
