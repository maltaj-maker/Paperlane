import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getCollectionBySlug } from '@/server/catalogue';
import { getWishlistBookIds } from '@/server/wishlist';
import { env } from '@/lib/env';
import { BookCard } from '@/components/books/BookCard';
import { EmptyState } from '@/components/ui/Feedback';
import { Breadcrumbs } from '@/components/ui/Navigation';
import { JsonLd } from '@/components/seo/JsonLd';
import { absoluteUrl, buildBreadcrumbSchema } from '@/lib/seo';

/**
 * Editorial collection.
 *
 * Collections are the shop's voice: "Rainy day reading", "Books we cannot stop
 * recommending". They are curated by a person, so there is no filter panel here
 * — a curated list with a search bar attached would undercut the whole point.
 *
 * Ordering is intentional, not by sales count, which is why this page does not
 * reuse the catalogue grid component. A curated shelf in exactly the order the
 * bookseller chose is the product.
 */

export const revalidate = 900;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCollectionBySlug(slug);
  if (!data) return { title: 'Collection not found', robots: { index: false, follow: true } };

  const { collection, books } = data;
  const description =
    collection.metaDescription ??
    collection.description?.slice(0, 155) ??
    collection.subtitle ??
    `${books.length} hand-picked titles from our shelves.`;

  return {
    title: collection.metaTitle ?? collection.title,
    description,
    alternates: { canonical: `/collections/${collection.slug}` },
    openGraph: {
      title: `${collection.title} · ${env().APP_NAME}`,
      description,
      url: `/collections/${collection.slug}`,
      type: 'website',
      ...(collection.heroImage ? { images: [{ url: collection.heroImage }] } : {}),
    },
  };
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getCollectionBySlug(slug);
  if (!data) notFound();

  const { collection, books } = data;
  const savedIds = await getWishlistBookIds().catch(() => []);
  const saved = new Set(savedIds);

  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'Collections', href: '/collections' },
    { label: collection.title },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <JsonLd
        data={[
          buildBreadcrumbSchema(crumbs),
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: collection.title,
            url: absoluteUrl(`/collections/${collection.slug}`),
            ...(collection.description ? { description: collection.description.slice(0, 500) } : {}),
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: books.length,
              itemListElement: books.slice(0, 30).map((book, index) => ({
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

      <header className="mb-9 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">
          {collection.isFeatured ? 'Featured collection' : 'Collection'}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {collection.title}
        </h1>
        {collection.subtitle && (
          <p className="mt-3 font-display text-lg text-ink-soft">{collection.subtitle}</p>
        )}
        {collection.description && (
          <p className="mt-4 text-sm leading-relaxed text-ink-soft sm:text-base">
            {collection.description}
          </p>
        )}
        <p className="mt-4 text-sm text-ink-muted">
          {books.length} {books.length === 1 ? 'title' : 'titles'} on this shelf
        </p>
      </header>

      {books.length === 0 ? (
        <EmptyState
          title="This shelf is empty for now"
          description="We are still choosing what belongs here. In the meantime, the rest of the shop is open."
          action={{ label: 'Browse all books', href: '/books' }}
          secondaryAction={{ label: 'See other collections', href: '/collections' }}
          className="rounded-2xl border border-line bg-paper"
        />
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {books.map((book, index) => (
            <li key={book.id}>
              <BookCard book={book} savedToWishlist={saved.has(book.id)} priority={index < 5} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-12 text-center text-sm text-ink-muted">
        Want a shelf of your own?{' '}
        <Link href="/books" className="text-ink underline decoration-line underline-offset-4">
          Start with the full catalogue
        </Link>{' '}
        and save what catches your eye to your wishlist.
      </p>
    </div>
  );
}
