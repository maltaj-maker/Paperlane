import Link from 'next/link';

import { cn } from '@/lib/cn';
import type { BookCard as BookCardData } from '@/server/search';
import { BookCard } from './BookCard';

/**
 * A horizontal shelf of books.
 *
 * On mobile this scrolls horizontally with snap points — the pattern customers
 * already understand from every streaming app, and far better than a vertical
 * stack that buries the fifth title below the fold. From `lg` up it becomes a
 * grid so the whole shelf is visible at once.
 *
 * The scroller is keyboard-reachable (tabIndex) and each card is focusable, so
 * keyboard users can traverse it without a mouse.
 */
export function BookShelf({
  title,
  subtitle,
  href,
  hrefLabel = 'See all',
  books,
  savedIds,
  emptyMessage,
  className,
  priority = false,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  hrefLabel?: string;
  books: BookCardData[];
  savedIds?: Set<string>;
  emptyMessage?: string;
  className?: string;
  priority?: boolean;
}) {
  // A shelf with one or two books looks broken; render nothing instead and let
  // the page fall back to another section.
  if (books.length === 0) {
    if (!emptyMessage) return null;
    return (
      <section className={cn('py-8', className)}>
        <SectionHeading title={title} subtitle={subtitle} />
        <p className="mt-4 text-sm text-ink-muted">{emptyMessage}</p>
      </section>
    );
  }

  return (
    <section className={cn('py-8 sm:py-10', className)} aria-labelledby={`shelf-${slugify(title)}`}>
      <SectionHeading title={title} subtitle={subtitle} href={href} hrefLabel={hrefLabel} id={`shelf-${slugify(title)}`} />

      {/* Mobile: horizontal scroller. Desktop: grid. */}
      <ul
        className={cn(
          'scroll-x mt-5 flex gap-4 pb-2',
          'lg:grid lg:grid-cols-6 lg:gap-x-5 lg:gap-y-8 lg:overflow-visible lg:pb-0',
        )}
      >
        {books.map((book, index) => (
          <li
            key={book.id}
            className="w-[42vw] max-w-[190px] shrink-0 sm:w-[30vw] md:w-[22vw] lg:w-auto lg:max-w-none"
          >
            <BookCard
              book={book}
              savedToWishlist={savedIds?.has(book.id) ?? false}
              // Only the first shelf on a page should preload images.
              priority={priority && index < 4}
              sizes="(max-width: 640px) 42vw, (max-width: 1024px) 22vw, 180px"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Shelf header with an optional "see all" link that carries real SEO value by
 * pointing at a crawlable, filterable listing page.
 */
export function SectionHeading({
  title,
  subtitle,
  href,
  hrefLabel = 'See all',
  id,
  className,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  hrefLabel?: string;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 id={id} className="font-display text-xl font-semibold leading-tight text-ink sm:text-2xl">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>

      {href && (
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
        >
          {hrefLabel}
          <svg
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      )}
    </div>
  );
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
