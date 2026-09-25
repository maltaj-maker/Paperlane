import type { Metadata } from 'next';
import Link from 'next/link';

import { db } from '@/server/db';
import { env } from '@/lib/env';
import { Breadcrumbs } from '@/components/ui/Navigation';
import { EmptyState } from '@/components/ui/Feedback';
import { JsonLd } from '@/components/seo/JsonLd';
import { absoluteUrl, buildBreadcrumbSchema } from '@/lib/seo';
import { PUBLISHED_BOOK_WHERE } from '@/server/catalogue';

/**
 * Authors A–Z.
 *
 * Sorted by name, not by popularity: someone who wants a particular author is
 * scanning, and a sales-ranked list would make them hunt. Only authors with at
 * least one published title appear, so the list never links to an empty page.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Authors',
  description:
    'Every author on our shelves, from debut novelists to the writers we keep re-ordering.',
  alternates: { canonical: '/authors' },
  openGraph: { title: `Authors · ${env().APP_NAME}`, url: '/authors', type: 'website' },
};

export default async function AuthorsPage() {
  const authors = await db.author
    .findMany({
      where: { deletedAt: null, books: { some: PUBLISHED_BOOK_WHERE } },
      select: {
        id: true,
        name: true,
        slug: true,
        nationality: true,
        _count: { select: { books: { where: PUBLISHED_BOOK_WHERE } } },
      },
      orderBy: { name: 'asc' },
      take: 400,
    })
    .catch(() => []);

  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Authors' }];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <JsonLd
        data={[
          buildBreadcrumbSchema(crumbs),
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Authors',
            url: absoluteUrl('/authors'),
          },
        ]}
      />

      <Breadcrumbs items={crumbs} className="mb-5" />

      <header className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Authors
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft sm:text-base">
          Everyone we stock, in alphabetical order. If a name is not here, we probably have not stocked them
          yet —{' '}
          <Link href="/contact" className="text-ink underline decoration-line underline-offset-4">
            tell us who you are after
          </Link>{' '}
          and we will try.
        </p>
      </header>

      {authors.length === 0 ? (
        <EmptyState
          title="No authors listed yet"
          description="Our catalogue is still being put on the shelves."
          action={{ label: 'Browse all books', href: '/books' }}
          className="mt-10"
        />
      ) : (
        <ul className="mt-10 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {authors.map((author) => (
            <li key={author.id} className="border-b border-line pb-2.5">
              <Link
                href={`/authors/${author.slug}`}
                className="flex min-h-[44px] items-center justify-between gap-3 text-ink transition-colors hover:text-ink-soft"
              >
                <span className="truncate font-medium">{author.name}</span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {author._count.books} {author._count.books === 1 ? 'book' : 'books'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
