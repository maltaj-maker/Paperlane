import Link from 'next/link';

import type { SearchResult, SortOption } from '@/server/search';
import { BookCard } from '@/components/books/BookCard';
import { BookGridSkeleton, EmptyState } from '@/components/ui/Feedback';
import { Pagination, ResultCount } from '@/components/ui/Navigation';
import { CatalogueFilters } from './CatalogueFilters';
import { CatalogueToolbar } from './CatalogueToolbar';

/**
 * The catalogue grid, filter panel, sort control and pagination — the part every
 * listing page shares.
 *
 * Extracted so `/books`, `/genres/*`, `/authors/*`, `/publishers/*` and
 * `/collections/*` cannot drift apart. A customer should not be able to tell
 * which page they are on by how the grid behaves, and a bug fixed here is fixed
 * on all of them.
 *
 * It is a server component: results arrive already fetched and rendered, which
 * is what keeps these pages fast and crawlable. Only the two interactive pieces
 * (filters, toolbar) are client components.
 */
export function CatalogueResults({
  result,
  savedBookIds,
  sort,
  activeFilterCount,
  buildHref,
  filters,
  emptyTitle,
  emptyDescription,
  clearHref,
  className,
}: {
  result: SearchResult;
  savedBookIds: string[];
  sort: string;
  activeFilterCount: number;
  /** Page-number → URL, preserving the current filters. */
  buildHref: (page: number) => string;
  filters: {
    genres: Array<{
      id: string;
      name: string;
      slug: string;
      children: Array<{ name: string; slug: string }>;
    }>;
    publishers: Array<{ name: string; slug: string }>;
  };
  emptyTitle: string;
  emptyDescription: string;
  clearHref: string;
  className?: string;
}) {
  const saved = new Set(savedBookIds);

  return (
    <div className={className}>
      <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-10">
        <CatalogueFilters
          genres={filters.genres}
          publishers={filters.publishers}
          languages={result.facets.languages.map((l) => ({ value: l.value, label: l.label, count: l.count }))}
          formats={result.facets.formats.map((f) => ({ value: f.value, label: f.label, count: f.count }))}
          priceRanges={result.facets.priceRanges}
          ratings={result.facets.ratings}
          activeCount={activeFilterCount}
        />

        <div className="min-w-0">
          <CatalogueToolbar
            total={result.total}
            showing={result.items.length}
            sort={sort}
            didYouMean={result.didYouMean}
          />

          <ResultCount
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            noun="books"
            className="mt-3"
          />

          {result.items.length === 0 ? (
            <EmptyState
              title={emptyTitle}
              description={
                result.didYouMean
                  ? `We could not find anything for that exact search. Try “${result.didYouMean}” instead.`
                  : emptyDescription
              }
              action={{ label: 'Clear all filters', href: clearHref }}
              secondaryAction={{ label: 'Browse by genre', href: '/genres' }}
              className="mt-6 rounded-xl border border-line bg-paper"
            />
          ) : (
            <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {result.items.map((book, index) => (
                <li key={book.id}>
                  {/*
                    Only the first row loads eagerly. Everything below the fold
                    lazy-loads with a reserved aspect ratio, which is what keeps
                    the layout stable on a phone as covers stream in.
                  */}
                  <BookCard book={book} savedToWishlist={saved.has(book.id)} priority={index < 4} />
                </li>
              ))}
            </ul>
          )}

          {result.totalPages > 1 && (
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              buildHref={buildHref}
              className="mt-12"
              label="Catalogue pages"
            />
          )}

          {/*
            A gentle nudge rather than a dead end when a search finds nothing and
            the customer has not filtered anything.
          */}
          {result.total === 0 && activeFilterCount === 0 && (
            <p className="mt-6 text-center text-sm text-ink-muted">
              Nothing here yet. Tell us what you are looking for and we will try to track it down —{' '}
              <Link href="/contact" className="text-ink underline decoration-line underline-offset-4">
                send us a note
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shared shape for the repeated "did you mean" wording across listing pages. */
export function sortOptionFrom(value: string | undefined): SortOption {
  const allowed: SortOption[] = [
    'relevance',
    'popularity',
    'newest',
    'price_asc',
    'price_desc',
    'rating',
    'discount',
  ];
  return (allowed as string[]).includes(value ?? '') ? (value as SortOption) : 'relevance';
}
