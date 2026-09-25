import type { Metadata } from 'next';
import Link from 'next/link';

import { getGenreTree } from '@/server/catalogue';
import { absoluteUrl, buildBreadcrumbSchema } from '@/lib/seo';
import { env } from '@/lib/env';
import { Breadcrumbs } from '@/components/ui/Navigation';
import { EmptyState } from '@/components/ui/Feedback';
import { JsonLd } from '@/components/seo/JsonLd';

/**
 * All genres.
 *
 * A hub for browsing and, more importantly, for internal linking: every genre
 * page is reachable from here in one hop, which is what lets search engines find
 * and rank them. Genres with no stock are shown but de-emphasised rather than
 * hidden, so the taxonomy stays honest as stock changes.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Browse by genre',
  description:
    'Every shelf in the shop, from literary fiction and crime to poetry, history and children’s books. Start with a genre and see where you end up.',
  alternates: { canonical: '/genres' },
  openGraph: {
    title: `Browse by genre · ${env().APP_NAME}`,
    url: '/genres',
    type: 'website',
  },
};

export default async function GenresPage() {
  const genres = await getGenreTree();
  const stocked = genres.filter((genre) => genre.bookCount > 0);
  const empty = genres.filter((genre) => genre.bookCount === 0);

  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'Genres' },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <JsonLd
        data={[
          buildBreadcrumbSchema(crumbs),
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Browse by genre',
            url: absoluteUrl('/genres'),
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: stocked.length,
              itemListElement: stocked.map((genre, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                url: absoluteUrl(`/genres/${genre.slug}`),
                name: `${genre.name} books`,
              })),
            },
          },
        ]}
      />

      <Breadcrumbs items={crumbs} className="mb-5" />

      <header className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Browse by genre
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft sm:text-base">
          Picking a shelf is often easier than knowing the title you want. Start somewhere and follow
          what looks interesting — we have sub-genres under each of these.
        </p>
      </header>

      {stocked.length === 0 ? (
        <EmptyState
          title="Our shelves are being stocked"
          description="We are adding titles right now. Tell us what you are looking for and we will let you know when it lands."
          action={{ label: 'Tell us what you want', href: '/contact' }}
          secondaryAction={{ label: 'Browse everything', href: '/books' }}
          className="mt-10"
        />
      ) : (
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {stocked.map((genre) => (
            <li key={genre.id}>
              <article className="group h-full rounded-2xl border border-line bg-paper p-5 transition-colors hover:border-ink/25">
                <h2 className="font-display text-lg font-semibold text-ink">
                  <Link
                    href={`/genres/${genre.slug}`}
                    // Stretched link: the whole card is the target, but the
                    // accessible name stays the genre, not "read more".
                    className="after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {genre.name}
                  </Link>
                </h2>

                <p className="mt-1.5 text-sm text-ink-muted">
                  {genre.bookCount} {genre.bookCount === 1 ? 'title' : 'titles'}
                </p>

                {genre.description && (
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-soft">
                    {genre.description}
                  </p>
                )}

                {genre.children.length > 0 && (
                  <ul className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
                    {genre.children
                      .filter((child) => child.bookCount > 0)
                      .slice(0, 5)
                      .map((child) => (
                        <li key={child.id}>
                          <Link
                            href={`/genres/${child.slug}`}
                            /*
                              The child links sit above the stretched heading link
                              so they stay clickable; without the z-index they
                              would be swallowed by the card's overlay.
                            */
                            className="relative z-10 text-xs text-ink-muted underline decoration-line underline-offset-4 hover:text-ink"
                          >
                            {child.name}
                          </Link>
                        </li>
                      ))}
                  </ul>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}

      {empty.length > 0 && (
        <section className="mt-12 border-t border-line pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Shelves we are still filling
          </h2>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {empty.map((genre) => (
              <li key={genre.id}>
                <Link
                  href={`/genres/${genre.slug}`}
                  className="text-ink-muted underline decoration-line underline-offset-4 hover:text-ink"
                >
                  {genre.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
