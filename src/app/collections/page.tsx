import type { Metadata } from 'next';
import Link from 'next/link';

import { db } from '@/server/db';
import { env } from '@/lib/env';
import { Breadcrumbs } from '@/components/ui/Navigation';
import { EmptyState } from '@/components/ui/Feedback';
import { JsonLd } from '@/components/seo/JsonLd';
import { absoluteUrl, buildBreadcrumbSchema } from '@/lib/seo';

/**
 * Collections index.
 *
 * These are the shop's curated shelves. They are the most human part of the
 * storefront, so the index gives each one room: a title, a line of context and
 * a cover image where there is one, rather than a dense grid of links.
 */
export const revalidate = 900;

export const metadata: Metadata = {
  title: 'Collections',
  description:
    'Hand-picked shelves from our booksellers — seasonal reading, staff favourites and lists we keep coming back to.',
  alternates: { canonical: '/collections' },
  openGraph: { title: `Collections · ${env().APP_NAME}`, url: '/collections', type: 'website' },
};

export default async function CollectionsPage() {
  const collections = await db.collection
    .findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        slug: true,
        title: true,
        subtitle: true,
        description: true,
        heroImage: true,
        isFeatured: true,
        kind: true,
        _count: { select: { books: true } },
      },
      orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { title: 'asc' }],
      take: 60,
    })
    .catch(() => []);

  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Collections' }];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <JsonLd
        data={[
          buildBreadcrumbSchema(crumbs),
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Collections',
            url: absoluteUrl('/collections'),
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: collections.length,
              itemListElement: collections.map((collection, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                url: absoluteUrl(`/collections/${collection.slug}`),
                name: collection.title,
              })),
            },
          },
        ]}
      />

      <Breadcrumbs items={crumbs} className="mb-5" />

      <header className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Collections
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft sm:text-base">
          Shelves we have put together by hand — the ones we reach for when someone asks what to read next.
        </p>
      </header>

      {collections.length === 0 ? (
        <EmptyState
          title="No collections yet"
          description="We are putting the first ones together. In the meantime, the full catalogue is open."
          action={{ label: 'Browse all books', href: '/books' }}
          secondaryAction={{ label: 'Browse by genre', href: '/genres' }}
          className="mt-10"
        />
      ) : (
        <ul className="mt-10 grid gap-6 sm:grid-cols-2">
          {collections.map((collection) => (
            <li key={collection.id}>
              <Link
                href={`/collections/${collection.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-paper transition-colors hover:border-ink/25"
              >
                {collection.heroImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={collection.heroImage}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-40 w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                )}

                <div className="flex flex-1 flex-col p-5">
                  {collection.isFeatured && (
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                      Featured
                    </span>
                  )}
                  <h2 className="mt-1.5 font-display text-lg font-semibold text-ink">
                    {collection.title}
                  </h2>
                  {collection.subtitle && (
                    <p className="mt-1 text-sm text-ink-muted">{collection.subtitle}</p>
                  )}
                  {collection.description && (
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-ink-soft">
                      {collection.description}
                    </p>
                  )}
                  <p className="mt-4 text-xs text-ink-faint">
                    {collection._count.books} {collection._count.books === 1 ? 'title' : 'titles'}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
