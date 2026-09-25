import Link from 'next/link';
import Image from 'next/image';

import { cn } from '@/lib/cn';
import type { BookCard as BookCardData } from '@/server/search';
import { Rating } from '@/components/ui/Rating';
import { Badge, StockBadge } from '@/components/ui/Feedback';
import { Price, PriceBadge } from '@/components/ui/Price';
import { QuickAddButton } from './QuickAddButton';
import { WishlistButton } from './WishlistButton';
import { BOOK_FORMAT_LABEL } from '@/lib/constants';

/**
 * The catalogue workhorse: this card appears on the homepage shelves, search
 * results, genre pages and every recommendation rail. One component means one
 * place to fix a layout bug or change the information hierarchy.
 *
 * Mobile-first decisions:
 *  - The whole card is one tap target (the cover + title link), because tapping
 *    a 12px author name on a phone is miserable.
 *  - Quick-add sits inside the card but is a separate button with its own
 *    accessible name, so screen-reader users can distinguish "view book" from
 *    "add to basket".
 *  - The wishlist control only appears on hover for pointer devices; on touch it
 *    is always visible, since there is no hover to reveal it with.
 */
export function BookCard({
  book,
  priority = false,
  sizes = '(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px',
  savedToWishlist = false,
  className,
  /** Hide the quick-add button in dense editorial contexts. */
  showQuickAdd = true,
}: {
  book: BookCardData;
  priority?: boolean;
  sizes?: string;
  savedToWishlist?: boolean;
  className?: string;
  showQuickAdd?: boolean;
}) {
  const inStock = book.availability.status !== 'out_of_stock';
  const preorder = book.availability.status === 'preorder';
  const href = `/books/${book.slug}`;

  // A pre-order is technically not "buyable now", so the label is explicit.
  const actionLabel = preorder ? 'Pre-order' : 'Add to basket';

  return (
    <article className={cn('group relative flex flex-col', className)}>
      <div className="relative">
        <Link
          href={href}
          className="block overflow-hidden rounded-md"
          // `tabular-nums` stops prices jittering as they change in a grid.
          aria-label={`${book.title} by ${book.authorName}${book.discountPercent > 0 ? `, ${book.discountPercent}% off` : ''}`}
        >
          <div className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-paper-sunken shadow-book transition-shadow duration-300 group-hover:shadow-book-lg">
            {book.coverImageUrl ? (
              <Image
                src={book.coverImageUrl}
                alt={book.coverAlt ?? `${book.title} by ${book.authorName} — book cover`}
                fill
                sizes={sizes}
                priority={priority}
                loading={priority ? 'eager' : 'lazy'}
                className="cover-art rounded-md object-cover transition-transform duration-500 ease-out-soft group-hover:scale-[1.03]"
              />
            ) : (
              <div className="flex h-full flex-col justify-between bg-gradient-to-br from-paper-soft to-paper-sunken p-3">
                <span className="h-1 w-8 rounded-full bg-ink/15" />
                <span className="clamp-3 font-display text-sm font-semibold leading-tight text-ink-soft">
                  {book.title}
                </span>
                <span className="h-1 w-5 rounded-full bg-ink/15" />
              </div>
            )}

            {/* Badges — at most two, so the artwork stays readable */}
            <div className="pointer-events-none absolute left-2 top-2 flex max-w-[85%] flex-col items-start gap-1">
              {book.discountPercent > 0 && <PriceBadge percent={book.discountPercent} />}
              {book.isNewRelease && <PriceBadge label="New" tone="ink" />}
              {book.isStaffPick && !book.isNewRelease && <PriceBadge label="Staff pick" tone="success" />}
            </div>
          </div>
        </Link>

        {/* Wishlist: always visible on touch, hover-revealed on pointer devices */}
        <div className="absolute right-1.5 top-1.5 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <WishlistButton
            bookId={book.id}
            bookTitle={book.title}
            initialSaved={savedToWishlist}
            size="sm"
          />
        </div>
      </div>

      <div className="mt-3 flex min-w-0 flex-1 flex-col">
        <h3 className="clamp-2 font-display text-[15px] font-semibold leading-snug">
          <Link href={href} className="text-ink transition-colors hover:text-accent">
            {book.title}
          </Link>
        </h3>

        <p className="mt-1 clamp-1 text-xs text-ink-muted">
          <Link href={`/authors/${book.authorSlug}`} className="transition-colors hover:text-ink">
            {book.authorName}
          </Link>
        </p>

        {book.ratingCount > 0 ? (
          <div className="mt-1.5">
            <Rating value={book.ratingAvg} count={book.ratingCount} size="sm" />
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-ink-faint">
            {BOOK_FORMAT_LABEL[book.format] ?? book.format}
            {book.pageCount ? ` · ${book.pageCount} pages` : ''}
          </p>
        )}

        <div className="mt-auto pt-2.5">
          <Price pricePaise={book.pricePaise} salePricePaise={book.salePricePaise} size="sm" />

          <div className="mt-1.5 flex items-center gap-2">
            <StockBadge
              status={book.availability.status}
              available={book.availability.available}
              showCount={book.availability.available <= 3}
            />
            {book.availability.status === 'low_stock' && book.availability.available > 3 && (
              <span className="text-2xs text-ink-faint">Selling fast</span>
            )}
          </div>

          {showQuickAdd && (
            <div className="mt-2.5">
              <QuickAddButton
                bookId={book.id}
                bookTitle={book.title}
                expectedUnitPricePaise={book.sellingPricePaise}
                disabled={!inStock && !preorder}
                label={actionLabel}
              />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Compact horizontal card used in list-mode results, order history and
 * "frequently bought together" rows where a full grid card would be too heavy.
 */
export function BookListItem({
  book,
  savedToWishlist = false,
  className,
  action,
}: {
  book: BookCardData;
  savedToWishlist?: boolean;
  className?: string;
  action?: React.ReactNode;
}) {
  const href = `/books/${book.slug}`;
  const inStock = book.availability.status !== 'out_of_stock';

  return (
    <article className={cn('flex gap-4 border-b border-line py-5 last:border-0', className)}>
      <Link href={href} className="shrink-0" tabIndex={-1} aria-hidden="true">
        <div className="relative h-[126px] w-[84px] overflow-hidden rounded-md bg-paper-sunken shadow-book">
          {book.coverImageUrl ? (
            <Image
              src={book.coverImageUrl}
              alt=""
              fill
              sizes="84px"
              loading="lazy"
              className="cover-art object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-2">
              <span className="clamp-3 text-center text-2xs font-medium text-ink-soft">{book.title}</span>
            </div>
          )}
        </div>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="clamp-2 font-display text-base font-semibold leading-snug">
              <Link href={href} className="text-ink transition-colors hover:text-accent">
                {book.title}
              </Link>
            </h3>
            <p className="mt-0.5 text-sm text-ink-muted">{book.authorName}</p>
          </div>

          <WishlistButton bookId={book.id} bookTitle={book.title} initialSaved={savedToWishlist} size="sm" />
        </div>

        {book.ratingCount > 0 && (
          <div className="mt-1.5">
            <Rating value={book.ratingAvg} count={book.ratingCount} size="sm" />
          </div>
        )}

        <p className="mt-2 clamp-2 text-sm leading-relaxed text-ink-muted">
          {book.subtitle ?? book.genreName ?? BOOK_FORMAT_LABEL[book.format]}
        </p>

        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
          <div>
            <Price pricePaise={book.pricePaise} salePricePaise={book.salePricePaise} size="md" showSaving />
            <div className="mt-1">
              <StockBadge status={book.availability.status} available={book.availability.available} />
            </div>
          </div>

          {action ?? (
            <QuickAddButton
              bookId={book.id}
              bookTitle={book.title}
              expectedUnitPricePaise={book.sellingPricePaise}
              disabled={!inStock}
            />
          )}
        </div>
      </div>
    </article>
  );
}

/** Small inline "also available in" chips used under a title. */
export function FormatChips({ formats, className }: { formats: string[]; className?: string }) {
  if (formats.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {formats.map((format) => (
        <Badge key={format} tone="outline" size="sm">
          {BOOK_FORMAT_LABEL[format] ?? format}
        </Badge>
      ))}
    </div>
  );
}
