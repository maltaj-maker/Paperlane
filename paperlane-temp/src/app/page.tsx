import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

import { env } from '@/lib/env';
import { formatPaise } from '@/lib/money';
import { getHomePageData, listFeaturedAuthors } from '@/server/catalogue';
import { getBanners, getTestimonials, isFeatureEnabled, listBlogPosts } from '@/server/content';
import { getCurrentUser } from '@/server/auth';
import { getWishlistBookIds } from '@/server/wishlist';
import { BANNER_PLACEMENT } from '@/lib/constants';
import { BookShelf, SectionHeading } from '@/components/books/BookShelf';
import { BookCard } from '@/components/books/BookCard';
import { Price } from '@/components/ui/Price';
import { Rating } from '@/components/ui/Rating';
import { Badge } from '@/components/ui/Feedback';
import { formatCount } from '@/lib/cn';
import { ReadingRoomTeaser } from '@/components/marketing/ReadingRoomTeaser';

/**
 * Homepage.
 *
 * Structure follows how a bookshop is actually browsed: a hero that says what
 * this place is, then shelves in decreasing order of intent — new arrivals,
 * bestsellers, staff picks, then discovered-by-genre. A first-time visitor from
 * Instagram needs to see a specific, appealing book within one screen; brand
 * copy goes second.
 *
 * Everything is server-rendered and the shelf queries run in parallel, because
 * this is the most latency-sensitive page in the store.
 */
export const revalidate = 300; // 5 minutes — long enough to be cheap, short enough to stay fresh

export const metadata: Metadata = {
  title: 'Books worth your evening — independent online bookshop',
  description:
    'Handpicked fiction, non-fiction and children’s books with honest reviews and fast delivery across India. New releases, bestsellers and staff picks from an independent bookshop.',
  alternates: { canonical: '/' },
  openGraph: {
    title: `${env().APP_NAME} — books worth your evening`,
    description: 'Handpicked books, honest reviews, fast delivery across India.',
    url: '/',
    type: 'website',
  },
};

export default async function HomePage() {
  const user = await getCurrentUser().catch(() => null);

  const [data, banners, testimonials, featuredAuthors, recentPosts, savedIds, wishlistEnabled, blogEnabled] =
    await Promise.all([
      getHomePageData({ viewerId: user?.id ?? null }),
      getBanners(BANNER_PLACEMENT.HOME_HERO, 1),
      getTestimonials(3),
      listFeaturedAuthors(6),
      listBlogPosts({ pageSize: 3 }).catch(() => ({ items: [], total: 0, page: 1, pageSize: 3, totalPages: 0 })),
      getWishlistBookIds().catch(() => []),
      isFeatureEnabled('wishlist'),
      isFeatureEnabled('blog'),
    ]);

  const saved = new Set(savedIds);
  const hero = data.heroBooks[0];

  // If the catalogue is empty we are almost certainly on a fresh install; show
  // honest setup guidance rather than a broken page full of empty shelves.
  const isEmpty = data.stats.titles === 0;

  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden border-b border-line bg-paper-soft">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-2 lg:items-center lg:gap-14 lg:py-20">
          <div className="min-w-0">
            <Badge tone="outline" className="mb-4">
              Independent bookshop · Delivering across India
            </Badge>

            <h1 className="font-display text-3xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-4xl lg:text-5xl">
              {banners[0]?.title ?? 'Books worth your evening'}
            </h1>

            <p className="mt-4 max-w-lg text-base leading-relaxed text-ink-muted sm:text-lg">
              {banners[0]?.subtitle ??
                'We read them first. Every title here comes with an honest verdict, not a publisher’s blurb — so you can spend your money on the right book.'}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href={banners[0]?.ctaHref ?? '/books?sort=newest'}
                className="inline-flex min-h-[52px] items-center rounded-full bg-brand-700 px-7 text-base font-semibold text-paper transition-colors hover:bg-brand-600"
              >
                {banners[0]?.ctaLabel ?? 'Browse new arrivals'}
              </Link>

              <Link
                href="/books?sort=popularity"
                className="inline-flex min-h-[52px] items-center rounded-full border border-line px-7 text-base font-medium text-ink transition-colors hover:bg-paper"
              >
                See bestsellers
              </Link>
            </div>

            <dl className="mt-9 flex flex-wrap gap-x-8 gap-y-4">
              <Stat label="Titles in stock" value={formatCount(data.stats.titles)} />
              <Stat label="Authors" value={formatCount(data.stats.authors)} />
              <Stat label="Genres" value={formatCount(data.stats.genres)} />
            </dl>
          </div>

          {/* Hero visual: the featured title, presented like a shop window */}
          {hero && (
            <div className="relative mx-auto flex w-full max-w-md items-center justify-center lg:max-w-none">
              <div className="relative flex w-full items-center justify-center gap-3 sm:gap-5">
                {data.heroBooks.slice(0, 3).map((book, index) => (
                  <Link
                    key={book.id}
                    href={`/books/${book.slug}`}
                    className={
                      index === 1
                        ? 'relative z-20 w-[38%] max-w-[190px] transition-transform duration-500 hover:-translate-y-2 sm:w-[34%]'
                        : 'relative z-10 w-[30%] max-w-[150px] opacity-95 transition-transform duration-500 hover:-translate-y-1.5'
                    }
                  >
                    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-paper-sunken shadow-book-lg">
                      {book.coverImageUrl ? (
                        <Image
                          src={book.coverImageUrl}
                          alt={`${book.title} by ${book.authorName}`}
                          fill
                          sizes="(max-width: 1024px) 34vw, 200px"
                          priority
                          className="cover-art object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-end p-2.5">
                          <span className="clamp-3 font-display text-xs font-semibold text-ink-soft">{book.title}</span>
                        </div>
                      )}
                    </div>

                    {index === 1 && (
                      <div className="mt-3 text-center">
                        <p className="clamp-1 font-display text-sm font-semibold text-ink">{book.title}</p>
                        <p className="clamp-1 text-xs text-ink-muted">{book.authorName}</p>
                        <div className="mt-1.5 flex justify-center">
                          <Price
                            pricePaise={book.pricePaise}
                            salePricePaise={book.salePricePaise}
                            size="sm"
                          />
                        </div>
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        {isEmpty && <EmptyCatalogueNotice />}

        {/* ---------------- New releases ---------------- */}
        <BookShelf
          title="Just arrived"
          subtitle="The newest books on our shelves"
          href="/books?sort=newest"
          books={data.newReleases}
          savedIds={saved}
          priority
        />

        {/* ---------------- Editorial banner ---------------- */}
        {data.staffPicks.length > 0 && (
          <section className="my-6 rounded-2xl border border-line bg-accent-soft/50 p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
                  Staff picks
                </p>
                <h2 className="mt-2 font-display text-xl font-semibold text-ink sm:text-2xl">
                  Books we press into people&rsquo;s hands
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  Not the ones with the biggest marketing budget — the ones we actually finished and then
                  made someone else read.
                </p>
              </div>

              <Link
                href="/collections/staff-picks"
                className="inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-ink px-6 text-sm font-semibold text-paper transition-colors hover:bg-brand-600"
              >
                All staff picks
              </Link>
            </div>
          </section>
        )}

        {/* ---------------- Bestsellers ---------------- */}
        <BookShelf
          title="Bestsellers this month"
          subtitle="What everyone is reading right now"
          href="/books?sort=popularity"
          books={data.bestsellers}
          savedIds={saved}
        />

        {/* ---------------- For you (only when we have signal) ---------------- */}
        {data.forYou.length > 0 && (
          <BookShelf
            title="Because you read"
            subtitle="Picked from your orders, saves and browsing"
            href="/account/recommendations"
            hrefLabel="More recommendations"
            books={data.forYou}
            savedIds={saved}
          />
        )}

        {/* ---------------- Genres ---------------- */}
        {data.genres.length > 0 && (
          <section className="py-8 sm:py-10" aria-labelledby="genres-heading">
            <SectionHeading
              id="genres-heading"
              title="Browse by genre"
              subtitle="Start somewhere and wander"
              href="/genres"
              hrefLabel="All genres"
            />

            <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.genres.map((genre) => (
                <li key={genre.id}>
                  <Link
                    href={`/genres/${genre.slug}`}
                    className="group flex h-full flex-col justify-between rounded-xl border border-line bg-paper p-4 transition-colors hover:border-ink-faint hover:bg-paper-soft"
                  >
                    <div>
                      <h3 className="font-display text-base font-semibold text-ink">{genre.name}</h3>
                      <p className="mt-1 clamp-2 text-xs leading-relaxed text-ink-muted">
                        {genre.description ?? `Explore ${genre.name.toLowerCase()}`}
                      </p>
                    </div>

                    <p className="mt-3 text-2xs font-medium uppercase tracking-wide text-ink-faint">
                      {genre.bookCount} {genre.bookCount === 1 ? 'title' : 'titles'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------- Trending ---------------- */}
        <BookShelf
          title="Trending in the shop"
          subtitle="Most viewed in the last week"
          href="/books?sort=popularity&trending=1"
          books={data.trending}
          savedIds={saved}
        />

        {/* ---------------- Offers ---------------- */}
        {data.onSale.length > 0 && (
          <BookShelf
            title="On offer"
            subtitle="Reduced this week — same books, smaller price"
            href="/books?onSale=1"
            books={data.onSale}
            savedIds={saved}
          />
        )}

        {/* ---------------- Recently viewed ---------------- */}
        {data.recentlyViewed.length > 0 && (
          <BookShelf
            title="Back where you left off"
            subtitle="Books you looked at recently"
            books={data.recentlyViewed}
            savedIds={saved}
          />
        )}

        {/* ---------------- Author spotlights ---------------- */}
        {featuredAuthors.length > 0 && (
          <section className="py-8 sm:py-10" aria-labelledby="authors-heading">
            <SectionHeading
              id="authors-heading"
              title="Authors to know"
              subtitle="Writers we keep coming back to"
              href="/authors"
              hrefLabel="All authors"
            />

            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featuredAuthors.map((author) => (
                <li key={author.id}>
                  <Link
                    href={`/authors/${author.slug}`}
                    className="group flex h-full gap-4 rounded-xl border border-line bg-paper p-4 transition-colors hover:border-ink-faint"
                  >
                    <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-paper-sunken">
                      {author.photoUrl ? (
                        <Image
                          src={author.photoUrl}
                          alt=""
                          fill
                          sizes="64px"
                          className="object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center font-display text-lg font-semibold text-ink-muted">
                          {author.name.charAt(0)}
                        </span>
                      )}
                    </span>

                    <span className="min-w-0">
                      <span className="block font-display text-base font-semibold text-ink">{author.name}</span>
                      <span className="mt-0.5 block text-2xs uppercase tracking-wide text-ink-faint">
                        {author._count.books} {author._count.books === 1 ? 'title' : 'titles'}
                        {author.nationality ? ` · ${author.nationality}` : ''}
                      </span>
                      {author.bio && (
                        <span className="mt-2 clamp-2 block text-xs leading-relaxed text-ink-muted">
                          {author.bio}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------- Collections ---------------- */}
        {data.collections.length > 0 && (
          <section className="py-8 sm:py-10" aria-labelledby="collections-heading">
            <SectionHeading
              id="collections-heading"
              title="Curated collections"
              subtitle="Hand-built lists for a mood or a moment"
              href="/collections"
              hrefLabel="All collections"
            />

            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.collections.map((collection) => (
                <li key={collection.id}>
                  <Link
                    href={`/collections/${collection.slug}`}
                    className="group relative flex h-40 flex-col justify-end overflow-hidden rounded-xl border border-line bg-paper-soft p-5 transition-colors hover:border-ink-faint"
                  >
                    {collection.heroImage && (
                      <Image
                        src={collection.heroImage}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 100vw, 33vw"
                        className="object-cover opacity-25 transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                    )}
                    <div className="relative">
                      <h3 className="font-display text-lg font-semibold text-ink">{collection.title}</h3>
                      {collection.subtitle && (
                        <p className="mt-1 clamp-2 text-xs text-ink-muted">{collection.subtitle}</p>
                      )}
                      <p className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-faint">
                        {collection.bookCount} {collection.bookCount === 1 ? 'title' : 'titles'}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------- Testimonials ---------------- */}
        {testimonials.length > 0 && (
          <section className="py-8 sm:py-10" aria-labelledby="testimonials-heading">
            <SectionHeading id="testimonials-heading" title="What readers say" />

            <ul className="mt-5 grid gap-4 sm:grid-cols-3">
              {testimonials.map((testimonial) => (
                <li key={testimonial.id} className="rounded-xl border border-line bg-paper p-5">
                  {testimonial.rating && (
                    <Rating value={testimonial.rating} size="sm" showValue={false} className="mb-3" />
                  )}
                  <blockquote className="text-sm leading-relaxed text-ink-soft">
                    &ldquo;{testimonial.quote}&rdquo;
                  </blockquote>
                  <footer className="mt-3 flex items-center gap-2">
                    <p className="text-xs font-semibold text-ink">{testimonial.name}</p>
                    {testimonial.role && <p className="text-xs text-ink-muted">· {testimonial.role}</p>}
                  </footer>

                  {/* Demo content is always labelled. Presenting seeded copy as a
                      real customer review would be misleading. */}
                  {testimonial.isDemo && (
                    <p className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-faint">
                      Sample content
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------- Reading room ---------------- */}
        {blogEnabled && recentPosts.items.length > 0 && (
          <ReadingRoomTeaser posts={recentPosts.items} />
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-[0.12em] text-ink-faint">{label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Shown on a fresh install with no catalogue.
 * Honest guidance beats an empty grid of nothing.
 */
function EmptyCatalogueNotice() {
  return (
    <section className="mt-8 rounded-xl border border-dashed border-line bg-paper-soft p-6 text-center">
      <h2 className="font-display text-lg font-semibold text-ink">Your catalogue is empty</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
        Nothing has been published yet. Add books from the admin panel, or run{' '}
        <code className="rounded bg-paper-sunken px-1.5 py-0.5 font-mono text-xs">npm run db:seed</code> to load
        a clearly-labelled demo catalogue for evaluation.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <Link
          href="/admin"
          className="inline-flex min-h-[44px] items-center rounded-full bg-brand-700 px-6 text-sm font-semibold text-paper"
        >
          Open admin panel
        </Link>
        <Link
          href="/books"
          className="inline-flex min-h-[44px] items-center rounded-full border border-line px-6 text-sm font-medium text-ink"
        >
          View catalogue
        </Link>
      </div>
    </section>
  );
}
