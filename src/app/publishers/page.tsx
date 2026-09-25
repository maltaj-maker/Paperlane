import type { Metadata } from 'next';
import Link from 'next/link';

import { listPublishers } from '@/server/catalogue';
import { env } from '@/lib/env';
import { Breadcrumbs } from '@/components/ui/Navigation';
import { EmptyState } from '@/components/ui/Feedback';
import { JsonLd } from '@/components/seo/JsonLd';
import { absoluteUrl, buildBreadcrumbSchema } from '@/lib/seo';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Publishers',
  description:
    'The publishers we buy from — big houses, university presses and small independents whose lists we follow closely.',
  alternates: { canonical: '/publishers' },
  openGraph: { title: `Publishers · ${env().APP_NAME}`, url: '/publishers', type: 'website' },
};

export default async function PublishersPage() {
  const publishers = await listPublishers(120);
  const stocked = publishers.filter((publisher) => publisher._count.books > 0);

  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Publishers' }];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <JsonLd
        data={[
          buildBreadcrumbSchema(crumbs),
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Publishers',
            url: absoluteUrl('/publishers'),
          },
        ]}
      />

      <Breadcrumbs items={crumbs} className="mb-5" />

      <header className="max-w-2xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Publishers
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft sm:text-base">
          A good list is worth following. These are the houses we buy from most often — including small
          independents we go out of our way to stock.
        </p>
      </header>

      {stocked.length === 0 ? (
        <EmptyState
          title="No publishers listed yet"
          description="Our catalogue is still being put on the shelves."
          action={{ label: 'Browse all books', href: '/books' }}
          className="mt-10"
        />
      ) : (
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stocked.map((publisher) => (
            <li key={publisher.id}>
              <Link
                href={`/publishers/${publisher.slug}`}
                className="flex h-full flex-col rounded-2xl border border-line bg-paper p-5 transition-colors hover:border-ink/25"
              >
                <span className="font-display text-base font-semibold text-ink">{publisher.name}</span>
                <span className="mt-1 text-xs text-ink-faint">
                  {publisher._count.books} {publisher._count.books === 1 ? 'title' : 'titles'}
                </span>
                {publisher.description && (
                  <span className="mt-3 line-clamp-3 text-sm leading-relaxed text-ink-soft">
                    {publisher.description}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
