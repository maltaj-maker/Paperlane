import type { Metadata } from 'next';
import { Suspense } from 'react';

import { searchBooks } from '@/server/search';
import { getGenreTree, listPublishers } from '@/server/catalogue';
import { getWishlistBookIds } from '@/server/wishlist';
import { searchQuerySchema, toArray } from '@/lib/validation';
import { env } from '@/lib/env';
import { BookGridSkeleton } from '@/components/ui/Feedback';
import { Breadcrumbs } from '@/components/ui/Navigation';
import { CatalogueResults, sortOptionFrom } from '@/components/catalogue/CatalogueResults';

/**
 * Catalogue listing and search results.
 *
 * One page serves both `/books` and `/books?q=…`. Search and browse are the same
 * activity from the customer's point of view — "show me books, and let me narrow
 * it down" — so they share filters, sorting and pagination rather than splitting
 * into two pages that drift apart.
 *
 * Crawlability rules, which are the reason this is server-rendered rather than a
 * client-side filter widget:
 *   - the clean listing is indexable;
 *   - any filtered or paginated view is `noindex, follow`, so thousands of
 *     near-duplicate URLs never compete with the real pages;
 *   - pagination uses real `<a>` links, so the whole catalogue is walkable.
 */

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  const query = typeof params.q === 'string' ? params.q.trim() : '';
  const genreSlugs = toArray(params.genre) ?? [];

  const filtered =
    genreSlugs.length > 0 ||
    Boolean(params.sort) ||
    Boolean(params.language) ||
    Boolean(params.format) ||
    Boolean(params.publisher) ||
    Boolean(params.minPrice) ||
    Boolean(params.rating) ||
    Boolean(params.inStock) ||
    Boolean(params.onSale);

  const title = query ? `Search: “${query.slice(0, 60)}”` : 'All books';

  return {
    title,
    description:
      'Browse every title on our shelves — filter by genre, language, format, price and rating. Careful packing and fast delivery across India.',
    // Filters and pagination must not compete with the clean listing.
    alternates: { canonical: '/books' },
    ...(filtered || page > 1 ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: `${title} · ${env().APP_NAME}`,
      url: '/books',
      type: 'website',
    },
  };
}

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;

  const parsed = searchQuerySchema.safeParse({
    q: raw.q,
    sort: raw.sort,
    page: raw.page,
    pageSize: raw.pageSize,
    genre: raw.genre,
    author: raw.author,
    publisher: raw.publisher,
    language: raw.language,
    format: raw.format,
    minPrice: raw.minPrice,
    maxPrice: raw.maxPrice,
    rating: raw.rating,
    inStock: raw.inStock,
    onSale: raw.onSale,
    isbn: raw.isbn,
  });

  // A malformed query string is a normal event (someone edited the URL), not an
  // error page: fall back to the unfiltered listing.
  const query = parsed.success ? parsed.data : searchQuerySchema.parse({});

  const [result, genres, publishers, savedIds] = await Promise.all([
    searchBooks({
      q: query.q,
      sort: sortOptionFrom(query.sort),
      page: query.page,
      pageSize: query.pageSize,
      genre: toArray(query.genre),
      author: toArray(query.author),
      publisher: toArray(query.publisher),
      language: toArray(query.language),
      format: toArray(query.format),
      minPricePaise: query.minPrice !== undefined ? query.minPrice * 100 : undefined,
      maxPricePaise: query.maxPrice !== undefined ? query.maxPrice * 100 : undefined,
      minRating: query.rating,
      inStockOnly: query.inStock,
      onSaleOnly: query.onSale,
      isbn: query.isbn,
    }),
    getGenreTree(),
    listPublishers(30),
    getWishlistBookIds().catch(() => []),
  ]);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'page' || value === undefined) continue;
      if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
      else params.append(key, value);
    }
    params.set('page', String(page));
    return `/books?${params.toString()}`;
  };

  const activeFilterCount = [
    toArray(raw.genre),
    toArray(raw.language),
    toArray(raw.format),
    toArray(raw.publisher),
    toArray(raw.author),
    raw.minPrice,
    raw.maxPrice,
    raw.rating,
    raw.inStock,
    raw.onSale,
  ].filter(Boolean).length;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'All books' }]} className="mb-5" />

      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {query.q ? `Results for “${query.q}”` : 'All books'}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          {query.q
            ? 'Narrow it down with the filters, or try a different spelling — we correct small typos automatically.'
            : 'Everything currently on our shelves. Use the filters to narrow things down, or wander and see what catches your eye.'}
        </p>
      </header>

      <Suspense fallback={<BookGridSkeleton count={12} />}>
        <CatalogueResults
          result={result}
          savedBookIds={savedIds}
          sort={query.sort ?? 'relevance'}
          activeFilterCount={activeFilterCount}
          buildHref={buildHref}
          filters={{
            genres: genres
              .filter((genre) => genre.bookCount > 0)
              .map((genre) => ({
                id: genre.id,
                name: genre.name,
                slug: genre.slug,
                children: genre.children
                  .filter((child) => child.bookCount > 0)
                  .map((child) => ({ name: child.name, slug: child.slug })),
              })),
            publishers: publishers.map((publisher) => ({ name: publisher.name, slug: publisher.slug })),
          }}
          emptyTitle="No books match those filters"
          emptyDescription="Try removing a filter or two, or search for something a little broader."
          clearHref="/books"
        />
      </Suspense>
    </div>
  );
}
