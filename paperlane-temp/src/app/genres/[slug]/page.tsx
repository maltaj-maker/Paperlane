import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getGenreBySlug, getGenreTree, getSiblingGenres, listPublishers } from '@/server/catalogue';
import { searchBooks } from '@/server/search';
import { getWishlistBookIds } from '@/server/wishlist';
import { searchQuerySchema, toArray } from '@/lib/validation';
import { env } from '@/lib/env';
import { BookGridSkeleton, EmptyState } from '@/components/ui/Feedback';
import { Breadcrumbs } from '@/components/ui/Navigation';
import { CatalogueResults, sortOptionFrom } from '@/components/catalogue/CatalogueResults';
import { JsonLd } from '@/components/seo/JsonLd';
import { absoluteUrl, buildBreadcrumbSchema } from '@/lib/seo';

/**
 * Genre / category page.
 *
 * These are the pages that earn organic traffic for a bookshop — "indian
 * poetry", "cosy crime" — so they are treated as first-class landing pages, not
 * as pre-filtered search results:
 *
 *  - a real editorial header (name, description) rather than the generic
 *    listing title, so the page has something to rank for;
 *  - sub-genre chips for lateral navigation and internal linking;
 *  - `CollectionPage` + `BreadcrumbList` structured data;
 *  - the clean genre URL is canonical, and filtered/paginated variants are
 *    `noindex, follow`.
 *
 * The listing itself is `searchBooks` with the genre pinned, so sorting,
 * pagination and facet counts stay identical to the rest of the catalogue.
 */

const PAGE_SIZE = 24;

export const revalidate = 600;

async function loadGenre(slug: string) {
  const genre = await getGenreBySlug(slug);
  if (!genre) return null;
  return genre;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { slug } = await params;
  const genre = await loadGenre(slug);
  if (!genre) return { title: 'Genre not found', robots: { index: false, follow: true } };

  const raw = await searchParams;
  const page = Number(raw.page ?? 1);
  const filtered =
    Boolean(raw.sort) ||
    Boolean(raw.language) ||
    Boolean(raw.format) ||
    Boolean(raw.minPrice) ||
    Boolean(raw.rating) ||
    Boolean(raw.inStock) ||
    Boolean(raw.onSale);

  const title = `${genre.name} books`;
  const description =
    genre.description?.slice(0, 155) ??
    `Browse ${genre._count.books} ${genre.name.toLowerCase()} titles in stock now, with careful packing and fast delivery across India.`;

  return {
    title,
    description,
    alternates: { canonical: `/genres/${genre.slug}` },
    ...(filtered || page > 1 ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: `${title} · ${env().APP_NAME}`,
      description,
      url: `/genres/${genre.slug}`,
      type: 'website',
    },
  };
}

export default async function GenrePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const genre = await loadGenre(slug);
  if (!genre) notFound();

  const raw = await searchParams;
  const parsed = searchQuerySchema.safeParse({
    sort: raw.sort,
    page: raw.page,
    language: raw.language,
    format: raw.format,
    minPrice: raw.minPrice,
    maxPrice: raw.maxPrice,
    rating: raw.rating,
    inStock: raw.inStock,
    onSale: raw.onSale,
  });
  const query = parsed.success ? parsed.data : searchQuerySchema.parse({});

  // Pin the genre and, when browsing a top-level genre, include its children —
  // "Fiction" should show crime and literary fiction too, or the page looks
  // half-empty next to its own sub-genres.
  const genreSlugs = [genre.slug, ...genre.children.map((child) => child.slug)];

  const [result, genres, publishers, savedIds, siblings] = await Promise.all([
    searchBooks({
      genre: genreSlugs,
      sort: sortOptionFrom(query.sort),
      page: query.page,
      pageSize: PAGE_SIZE,
      language: toArray(query.language),
      format: toArray(query.format),
      minPricePaise: query.minPrice !== undefined ? query.minPrice * 100 : undefined,
      maxPricePaise: query.maxPrice !== undefined ? query.maxPrice * 100 : undefined,
      minRating: query.rating,
      inStockOnly: query.inStock,
      onSaleOnly: query.onSale,
    }),
    getGenreTree(),
    listPublishers(30),
    getWishlistBookIds().catch(() => []),
    genre.parent ? getSiblingGenres(genre.parentId!, 8) : Promise.resolve([]),
  ]);

  const buildHref = (page: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'page' || value === undefined) continue;
      if (Array.isArray(value)) value.forEach((item) => search.append(key, item));
      else search.append(key, value);
    }
    search.set('page', String(page));
    return `/genres/${genre.slug}?${search.toString()}`;
  };

  const activeFilterCount = [
    toArray(raw.language),
    toArray(raw.format),
    raw.minPrice,
    raw.maxPrice,
    raw.rating,
    raw.inStock,
    raw.onSale,
  ].filter(Boolean).length;

  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'Genres', href: '/genres' },
    ...(genre.parent ? [{ label: genre.parent.name, href: `/genres/${genre.parent.slug}` }] : []),
    { label: genre.name, href: `/genres/${genre.slug}` },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <JsonLd
        data={[
          buildBreadcrumbSchema(crumbs),
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: `${genre.name} books`,
            ...(genre.description ? { description: genre.description.slice(0, 500) } : {}),
            url: absoluteUrl(`/genres/${genre.slug}`),
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: result.total,
              itemListElement: result.items.slice(0, 20).map((book, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                url: absoluteUrl(`/books/${book.slug}`),
                name: book.title,
              })),
            },
          },
        ]}
      />

      <Breadcrumbs items={crumbs} className="mb-5" />

      <header className="mb-8 border-b border-line pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">Genre</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {genre.name}
        </h1>

        {genre.description && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft sm:text-base">
            {genre.description}
          </p>
        )}

        <p className="mt-3 text-sm text-ink-muted">
          {result.total} {result.total === 1 ? 'title' : 'titles'} on the shelves
        </p>

        {genre.children.length > 0 && (
          <nav aria-label="Sub-genres" className="mt-5">
            <ul className="flex flex-wrap gap-2">
              {genre.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={`/genres/${child.slug}`}
                    className="inline-flex min-h-[36px] items-center rounded-full border border-line bg-paper px-3.5 text-sm text-ink-soft transition-colors hover:border-ink hover:text-ink"
                  >
                    {child.name}
                    <span className="ml-1.5 text-xs text-ink-faint">{child._count.books}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {siblings.length > 0 && (
          <nav aria-label="Related genres" className="mt-4">
            <p className="text-xs uppercase tracking-[0.14em] text-ink-faint">
              More in {genre.parent?.name}
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {siblings
                .filter((sibling) => sibling.slug !== genre.slug)
                .map((sibling) => (
                  <li key={sibling.id}>
                    <Link
                      href={`/genres/${sibling.slug}`}
                      className="text-ink-soft underline decoration-line underline-offset-4 transition-colors hover:text-ink"
                    >
                      {sibling.name}
                    </Link>
                  </li>
                ))}
            </ul>
          </nav>
        )}
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
              .filter((root) => root.bookCount > 0)
              .map((root) => ({
                id: root.id,
                name: root.name,
                slug: root.slug,
                children: root.children
                  .filter((child) => child.bookCount > 0)
                  .map((child) => ({ name: child.name, slug: child.slug })),
              })),
            publishers: publishers.map((publisher) => ({ name: publisher.name, slug: publisher.slug })),
          }}
          emptyTitle={`Nothing in ${genre.name} matches those filters`}
          emptyDescription="Try removing a filter, or browse everything in this genre."
          clearHref={`/genres/${genre.slug}`}
        />
      </Suspense>

      {result.total === 0 && activeFilterCount === 0 && (
        <EmptyState
          title={`We have no ${genre.name.toLowerCase()} titles listed yet`}
          description="We are adding stock all the time. Tell us what you are after and we will try to find it."
          action={{ label: 'Ask us to find it', href: '/contact' }}
          secondaryAction={{ label: 'Browse all genres', href: '/genres' }}
          className="mt-6"
        />
      )}
    </div>
  );
}

/**
 * Pre-render the most useful genre pages at build time; the rest render on
 * demand and are cached. Keeps first paint fast for the pages that actually get
 * linked to.
 */
export async function generateStaticParams() {
  try {
    const { db } = await import('@/server/db');
    const genres = await db.genre.findMany({
      where: { deletedAt: null },
      select: { slug: true },
      orderBy: { sortOrder: 'asc' },
      take: 60,
    });
    return genres.map((genre) => ({ slug: genre.slug }));
  } catch {
    // A build without a database (CI with no DB) should still succeed.
    return [];
  }
}
