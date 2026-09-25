import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getGenreTree, getPublisherBySlug, listPublishers } from '@/server/catalogue';
import { searchBooks } from '@/server/search';
import { getWishlistBookIds } from '@/server/wishlist';
import { searchQuerySchema, toArray } from '@/lib/validation';
import { env } from '@/lib/env';
import { BookGridSkeleton } from '@/components/ui/Feedback';
import { Breadcrumbs } from '@/components/ui/Navigation';
import { CatalogueResults, sortOptionFrom } from '@/components/catalogue/CatalogueResults';
import { JsonLd } from '@/components/seo/JsonLd';
import { absoluteUrl, buildBreadcrumbSchema } from '@/lib/seo';

/**
 * Publisher page.
 *
 * Small presses have a real following — people who like a particular list will
 * read it end to end — so this page is built to be browsed rather than searched:
 * the publisher's own description comes first, then everything we stock.
 */

export const revalidate = 600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const publisher = await getPublisherBySlug(slug);
  if (!publisher) return { title: 'Publisher not found', robots: { index: false, follow: true } };

  const description =
    publisher.metaDescription ??
    publisher.description?.slice(0, 155) ??
    `${publisher._count.books} titles from ${publisher.name}, in stock now with fast delivery across India.`;

  return {
    title: publisher.metaTitle ?? `${publisher.name} books`,
    description,
    alternates: { canonical: `/publishers/${publisher.slug}` },
    openGraph: {
      title: `${publisher.name} · ${env().APP_NAME}`,
      description,
      url: `/publishers/${publisher.slug}`,
      type: 'website',
    },
  };
}

export default async function PublisherPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const publisher = await getPublisherBySlug(slug);
  if (!publisher) notFound();

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

  const [result, genres, publishers, savedIds] = await Promise.all([
    searchBooks({
      publisher: [publisher.slug],
      sort: sortOptionFrom(query.sort),
      page: query.page,
      pageSize: 24,
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
  ]);

  const buildHref = (page: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'page' || value === undefined) continue;
      if (Array.isArray(value)) value.forEach((item) => search.append(key, item));
      else search.append(key, value);
    }
    search.set('page', String(page));
    return `/publishers/${publisher.slug}?${search.toString()}`;
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
    { label: 'Publishers', href: '/publishers' },
    { label: publisher.name },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <JsonLd
        data={[
          buildBreadcrumbSchema(crumbs),
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: publisher.name,
            url: absoluteUrl(`/publishers/${publisher.slug}`),
            ...(publisher.logoUrl ? { logo: absoluteUrl(publisher.logoUrl) } : {}),
            ...(publisher.website ? { sameAs: [publisher.website] } : {}),
          },
        ]}
      />

      <Breadcrumbs items={crumbs} className="mb-5" />

      <header className="mb-8 border-b border-line pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">Publisher</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {publisher.name}
        </h1>

        {publisher.description && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft sm:text-base">
            {publisher.description}
          </p>
        )}

        <p className="mt-3 text-sm text-ink-muted">
          {result.total} {result.total === 1 ? 'title' : 'titles'} in stock
        </p>

        {publisher.website && (
          <p className="mt-2 text-sm">
            <a
              href={publisher.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-soft underline decoration-line underline-offset-4 hover:text-ink"
            >
              Visit the publisher’s site
            </a>
          </p>
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
            publishers: publishers.map((item) => ({ name: item.name, slug: item.slug })),
          }}
          emptyTitle={`Nothing from ${publisher.name} matches those filters`}
          emptyDescription="Try removing a filter, or browse everything we stock from this publisher."
          clearHref={`/publishers/${publisher.slug}`}
        />
      </Suspense>
    </div>
  );
}
