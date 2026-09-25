import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getAuthorBySlug, getGenreTree, listPublishers } from '@/server/catalogue';
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
 * Author page.
 *
 * Authors are a genuine search intent — people search names, not titles — so this
 * page is built to rank: a biography, the bibliography in a stable order, and
 * `Person` structured data linking the author to each book.
 *
 * The listing reuses the shared catalogue grid, so sorting and filters behave
 * exactly as they do everywhere else. A customer who arrives from Google on an
 * author page should not meet a different interface than one who arrived at
 * `/books`.
 */

export const revalidate = 600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const author = await getAuthorBySlug(slug);
  if (!author) return { title: 'Author not found', robots: { index: false, follow: true } };

  const count = author.books.length;
  const description =
    author.metaDescription ??
    `${author.bio?.slice(0, 120) ?? `Books by ${author.name}`} — ${count} ${count === 1 ? 'title' : 'titles'} in stock with fast delivery across India.`;

  return {
    title: author.metaTitle ?? `${author.name} books`,
    description,
    alternates: { canonical: `/authors/${author.slug}` },
    openGraph: {
      title: `${author.name} · ${env().APP_NAME}`,
      description,
      url: `/authors/${author.slug}`,
      type: 'profile',
      ...(author.photoUrl ? { images: [{ url: author.photoUrl }] } : {}),
    },
  };
}

export default async function AuthorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const author = await getAuthorBySlug(slug);
  if (!author) notFound();

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
      author: [author.slug],
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
    return `/authors/${author.slug}?${search.toString()}`;
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
    { label: 'Authors', href: '/authors' },
    { label: author.name },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <JsonLd
        data={[
          buildBreadcrumbSchema(crumbs),
          {
            '@context': 'https://schema.org',
            '@type': 'Person',
            name: author.name,
            url: absoluteUrl(`/authors/${author.slug}`),
            ...(author.photoUrl ? { image: absoluteUrl(author.photoUrl) } : {}),
            ...(author.bio ? { description: author.bio.slice(0, 1000) } : {}),
            ...(author.nationality ? { nationality: author.nationality } : {}),
            ...(author.website ? { sameAs: [author.website] } : {}),
          },
        ]}
      />

      <Breadcrumbs items={crumbs} className="mb-5" />

      <header className="mb-8 flex flex-col gap-5 border-b border-line pb-6 sm:flex-row sm:items-start">
        {author.photoUrl && (
          /*
            A plain <img>, not next/image: portraits are small, already sized by
            the person uploading them, and this avoids the layout work of an
            intrinsic-ratio wrapper for a decorative sidebar image.
          */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={author.photoUrl}
            alt={author.name}
            width={112}
            height={112}
            loading="lazy"
            decoding="async"
            className="h-28 w-28 shrink-0 rounded-2xl object-cover"
          />
        )}

        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">Author</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {author.name}
          </h1>

          {author.nationality && (
            <p className="mt-1.5 text-sm text-ink-muted">{author.nationality}</p>
          )}

          {author.bio && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft sm:text-base">
              {author.bio}
            </p>
          )}

          <p className="mt-3 text-sm text-ink-muted">
            {result.total} {result.total === 1 ? 'title' : 'titles'} on our shelves
          </p>

          {author.website && (
            <p className="mt-2 text-sm">
              <a
                href={author.website}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-ink-soft underline decoration-line underline-offset-4 hover:text-ink"
              >
                Author’s website
              </a>
            </p>
          )}
        </div>
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
          emptyTitle={`Nothing by ${author.name} matches those filters`}
          emptyDescription="Try removing a filter, or look at everything we stock by this author."
          clearHref={`/authors/${author.slug}`}
        />
      </Suspense>

      <p className="mt-10 text-sm text-ink-muted">
        Looking for something by {author.name} we do not stock?{' '}
        <Link href="/contact" className="text-ink underline decoration-line underline-offset-4">
          Ask us to order it in
        </Link>
        .
      </p>
    </div>
  );
}
