import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

import { getBookDetail, getRecentlyViewed, hydrateCards } from '@/server/catalogue';
import { getCurrentUser } from '@/server/auth';
import { getSessionId } from '@/server/request-context';
import { getReviewsForBook } from '@/app/actions/reviews';
import { getWishlistBookIds } from '@/server/wishlist';
import { getDefaultEstimate, getReturnWindowDays } from '@/server/shipping';
import { isFeatureEnabled } from '@/server/content';
import { env } from '@/lib/env';
import { formatPaise } from '@/lib/money';
import { formatDate, formatDeliveryWindow } from '@/lib/cn';
import { BOOK_FORMAT_LABEL } from '@/lib/constants';
import { buildBookSchema, buildBreadcrumbSchema, buildItemListSchema, absoluteUrl } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { Breadcrumbs } from '@/components/ui/Navigation';
import { Price } from '@/components/ui/Price';
import { Rating } from '@/components/ui/Rating';
import { Badge, StockBadge } from '@/components/ui/Feedback';
import { BookGallery } from '@/components/books/BookGallery';
import { AddToCartForm } from '@/components/books/AddToCartForm';
import { WishlistButton } from '@/components/books/WishlistButton';
import { BackInStockForm } from '@/components/books/BackInStockForm';
import { ReviewSection } from '@/components/books/ReviewSection';
import { ShareButtons } from '@/components/books/ShareButtons';
import { ViewItemTracker } from '@/components/books/ViewItemTracker';
import { BookShelf } from '@/components/books/BookShelf';
import { BookCard } from '@/components/books/BookCard';

/**
 * Book detail page — the page every Instagram visit ultimately has to convert on.
 *
 * Mobile ordering is deliberate: cover and price first, then the buy block, then
 * everything else. Someone who tapped a Reel wants to confirm "this book, this
 * price" within one thumb-scroll; the description, details and reviews are for
 * the people who stay — and plenty do.
 *
 * Every element here is fed by real catalogue data. If there are no reviews it
 * says so. If there is no stock, the buy button is replaced by a restock alert
 * rather than a dead button that collects nothing.
 *
 * View tracking is *not* done during render: this page is cached, so a write
 * here would fire once per cache window instead of once per visit. The client
 * tracker posts to the API, which records the view and updates the
 * recently-viewed list.
 */

export const revalidate = 600;
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getBookDetail(slug).catch(() => null);

  if (!detail) {
    return { title: 'Book not found', robots: { index: false, follow: true } };
  }

  const book = detail.book;
  const price = book.salePricePaise ?? book.pricePaise;

  // The shop's own words about the book, trimmed to a length search engines
  // actually display, with the facts that drive clicks appended.
  const base = (book.metaDescription ?? book.synopsis ?? book.description).replace(/\s+/g, ' ');
  const description = `${base.slice(0, 130).trim()}… ${book.title} by ${book.author.name} — ${formatPaise(price)}.`;

  return {
    title: book.metaTitle ?? book.title,
    description,
    keywords: book.seoKeywords?.split(',').map((keyword) => keyword.trim()).filter(Boolean),
    alternates: { canonical: `/books/${book.slug}` },
    openGraph: {
      type: 'book',
      title: `${book.title}${book.subtitle ? `: ${book.subtitle}` : ''}`,
      description,
      url: `/books/${book.slug}`,
      images: book.coverImageUrl
        ? [{ url: book.coverImageUrl, width: 600, height: 900, alt: book.coverAlt ?? `${book.title} cover` }]
        : undefined,
      ...(book.publicationDate ? { publishedTime: book.publicationDate.toISOString() } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: book.title,
      description,
      images: book.coverImageUrl ? [book.coverImageUrl] : undefined,
    },
    other: {
      'book:isbn': book.isbn13 ?? '',
      'book:author': book.author.name,
      'product:price:amount': (price / 100).toFixed(2),
      'product:price:currency': book.currency,
    },
  };
}

export default async function BookPage({ params }: PageProps) {
  const { slug } = await params;
  const detail = await getBookDetail(slug);

  if (!detail) notFound();

  const { book, availability, reviewSummary } = detail;

  const [user, savedIds, reviewsData, estimate, returnDays, reviewsEnabled, sessionId] = await Promise.all([
    getCurrentUser().catch(() => null),
    getWishlistBookIds().catch(() => []),
    getReviewsForBook(book.id, { pageSize: 6, sort: 'helpful' }),
    getDefaultEstimate(),
    getReturnWindowDays(),
    isFeatureEnabled('reviews'),
    getSessionId(),
  ]);

  // "Recently viewed" excludes the page you are standing on — a rail containing
  // the current book tells the customer nothing.
  const recentlyViewed = await getRecentlyViewed(9, user?.id ?? null, user ? null : sessionId)
    .then((rows) => hydrateCards(rows.filter((row) => row.id !== book.id)))
    .catch(() => []);

  const saved = new Set(savedIds);

  const sellingPrice =
    book.salePricePaise && book.salePricePaise < book.pricePaise ? book.salePricePaise : book.pricePaise;

  const discountPercent =
    book.salePricePaise && book.salePricePaise < book.pricePaise
      ? Math.round(((book.pricePaise - book.salePricePaise) / book.pricePaise) * 100)
      : 0;

  const canBuy = availability.status !== 'out_of_stock';
  const isPreorder = availability.status === 'preorder';

  // Copies available to actually sell right now. For a pre-order the incoming
  // shipment is the honest number, not zero.
  const purchasable = isPreorder ? Math.max(availability.incoming, 0) : availability.available;

  const images = [
    { url: book.coverImageUrl, alt: book.coverAlt },
    ...book.images.map((image) => ({ url: image.url, alt: image.alt })),
  ].filter((image) => Boolean(image.url));

  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'Books', href: '/books' },
    ...(book.genre ? [{ label: book.genre.name, href: `/genres/${book.genre.slug}` }] : []),
    { label: book.title },
  ];

  const ageRange =
    book.ageRangeMin && book.ageRangeMax
      ? `${book.ageRangeMin}–${book.ageRangeMax} years`
      : book.ageRangeMin
        ? `${book.ageRangeMin}+ years`
        : null;

  const viewerBought =
    reviewsData.pendingMine?.isVerifiedPurchase === true ||
    reviewsData.items.some((review) => review.isOwn && review.isVerifiedPurchase);

  return (
    <>
      <JsonLd
        data={[
          buildBookSchema({
            title: book.title,
            subtitle: book.subtitle,
            slug: book.slug,
            description: book.synopsis ?? book.description,
            isbn13: book.isbn13,
            isbn10: book.isbn10,
            authorName: book.author.name,
            authorUrl: `/authors/${book.author.slug}`,
            publisherName: book.publisher?.name ?? null,
            publicationDate: book.publicationDate,
            pageCount: book.pageCount,
            language: book.language,
            format: book.format,
            coverImageUrl: book.coverImageUrl,
            pricePaise: book.pricePaise,
            salePricePaise: book.salePricePaise,
            availabilityStatus: availability.status,
            ratingAvg: reviewSummary.average,
            ratingCount: reviewSummary.count,
            genreName: book.genre?.name ?? null,
          }),
          buildBreadcrumbSchema(crumbs),
          ...(detail.frequentlyBoughtTogether.length > 0
            ? [
                buildItemListSchema({
                  name: `Frequently bought together with ${book.title}`,
                  items: detail.frequentlyBoughtTogether.map((item) => ({
                    name: item.title,
                    url: `/books/${item.slug}`,
                  })),
                }),
              ]
            : []),
        ]}
      />

      <ViewItemTracker
        bookId={book.id}
        bookTitle={book.title}
        pricePaise={sellingPrice}
        genreName={book.genre?.name ?? null}
      />

      <div className="mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6">
        <Breadcrumbs items={crumbs} className="mb-5" />
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-14">
          <BookGallery images={images} title={book.title} className="lg:sticky lg:top-24 lg:self-start" />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {book.genre && (
                <Link href={`/genres/${book.genre.slug}`}>
                  <Badge tone="outline" size="sm">
                    {book.genre.name}
                  </Badge>
                </Link>
              )}
              {book.isNewRelease && (
                <Badge tone="accent" size="sm">
                  New
                </Badge>
              )}
              {book.isStaffPick && (
                <Badge tone="success" size="sm">
                  Staff pick
                </Badge>
              )}
              {book.isTrending && (
                <Badge tone="info" size="sm">
                  Trending
                </Badge>
              )}
            </div>

            <h1 className="mt-3 font-display text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl lg:text-4xl">
              {book.title}
            </h1>

            {book.subtitle && (
              <p className="mt-2 text-base leading-relaxed text-ink-muted sm:text-lg">{book.subtitle}</p>
            )}

            <p className="mt-3 text-sm text-ink-muted">
              by{' '}
              <Link
                href={`/authors/${book.author.slug}`}
                className="font-medium text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
              >
                {book.author.name}
              </Link>
              {book.publisher && (
                <>
                  {' · '}
                  <Link href={`/publishers/${book.publisher.slug}`} className="transition-colors hover:text-ink">
                    {book.publisher.name}
                  </Link>
                </>
              )}
            </p>

            {reviewSummary.count > 0 ? (
              <a href="#reviews" className="mt-3 inline-flex items-center gap-2 rounded-md py-1">
                <Rating value={reviewSummary.average} count={reviewSummary.count} size="md" />
                <span className="text-xs text-ink-muted underline decoration-line underline-offset-4">
                  Read reviews
                </span>
              </a>
            ) : (
              <p className="mt-3 text-sm text-ink-faint">No reviews yet</p>
            )}

            <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
              <Price
                pricePaise={book.pricePaise}
                salePricePaise={book.salePricePaise}
                size="xl"
                showSaving
                taxNote={book.taxInclusive ? 'Inclusive of all taxes' : undefined}
              />

              {discountPercent > 0 && (
                <Badge tone="danger" size="md">
                  {discountPercent}% off
                </Badge>
              )}
            </div>

            <div className="mt-3">
              <StockBadge
                status={availability.status}
                available={availability.available}
                showCount={availability.available > 0 && availability.available <= 10}
              />
            </div>

            <div className="mt-6 border-t border-line pt-6">
              {canBuy ? (
                <AddToCartForm
                  bookId={book.id}
                  bookTitle={book.title}
                  availability={{
                    status: availability.status,
                    available: purchasable,
                    maxPerOrder: availability.maxPerOrder,
                  }}
                  sellingPricePaise={sellingPrice}
                  canBuy={canBuy}
                  isPreorder={isPreorder}
                />
              ) : (
                <BackInStockForm bookId={book.id} bookTitle={book.title} />
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <WishlistButton
                  bookId={book.id}
                  bookTitle={book.title}
                  initialSaved={saved.has(book.id)}
                  withLabel
                />

                <ShareButtons
                  url={absoluteUrl(`/books/${book.slug}`)}
                  title={`${book.title} by ${book.author.name}`}
                  instagramHandle={env().SOCIAL_INSTAGRAM_HANDLE}
                />
              </div>
            </div>

            {/* Delivery and returns: configurable promises, never invented ones. */}
            <dl className="mt-6 grid gap-4 rounded-xl border border-line bg-paper-soft p-4 sm:grid-cols-2">
              <div className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <path d="M3 7.5h11v9H3v-9zM14 10h4l3 3v3.5h-7V10z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <circle cx="7" cy="18" r="1.6" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="17" cy="18" r="1.6" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </span>
                <div>
                  <dt className="text-sm font-medium text-ink">Delivery</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {canBuy
                      ? `Dispatched within 24 hours — ${formatDeliveryWindow(estimate.from, estimate.to)}.`
                      : 'Once back in stock, dispatched within 24 hours.'}
                  </dd>
                </div>
              </div>

              <div className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <path d="M4 12a8 8 0 1114 5.3M4 12V7m0 5h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <dt className="text-sm font-medium text-ink">Returns</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {returnDays > 0
                      ? `${returnDays} days to return it if it is not for you.`
                      : 'Damaged or wrong item? Tell us and we will sort it out.'}{' '}
                    <Link href="/legal/returns" className="underline decoration-line underline-offset-4">
                      Return policy
                    </Link>
                  </dd>
                </div>
              </div>
            </dl>

            <section className="mt-8" aria-labelledby="about-heading">
              <h2 id="about-heading" className="font-display text-lg font-semibold text-ink">
                About this book
              </h2>

              {book.synopsis && (
                <p className="mt-3 max-w-measure text-base leading-relaxed text-ink-soft">{book.synopsis}</p>
              )}

              <div className="mt-4 max-w-measure space-y-3 text-sm leading-relaxed text-ink-soft">
                {book.description
                  .split(/\n{2,}/)
                  .filter(Boolean)
                  .map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
              </div>
            </section>

            <section className="mt-8" aria-labelledby="details-heading">
              <h2 id="details-heading" className="font-display text-lg font-semibold text-ink">
                Details
              </h2>

              <dl className="mt-3 grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
                <Detail label="Format" value={BOOK_FORMAT_LABEL[book.format] ?? book.format} />
                <Detail label="Language" value={book.language} />
                {book.edition && <Detail label="Edition" value={book.edition} />}
                {book.publisher && <Detail label="Publisher" value={book.publisher.name} />}
                {book.publicationDate && (
                  <Detail
                    label="Published"
                    value={formatDate(book.publicationDate, { year: 'numeric', month: 'long' })}
                  />
                )}
                {book.pageCount && <Detail label="Pages" value={String(book.pageCount)} />}
                {book.dimensions && <Detail label="Dimensions" value={book.dimensions} />}
                {book.weightGrams && <Detail label="Weight" value={`${book.weightGrams} g`} />}
                {ageRange && <Detail label="Reading age" value={ageRange} />}
                {book.isbn13 && <Detail label="ISBN-13" value={book.isbn13} mono />}
                {book.isbn10 && <Detail label="ISBN-10" value={book.isbn10} mono />}
              </dl>

              <p className="mt-4 text-xs text-ink-muted">
                Looking for a different edition?{' '}
                {book.isbn13 && (
                  <>
                    <Link
                      href={`/books?isbn=${book.isbn13}`}
                      className="underline decoration-line underline-offset-4 hover:decoration-ink"
                    >
                      Search by ISBN
                    </Link>{' '}
                    or{' '}
                  </>
                )}
                <Link href="/contact" className="underline decoration-line underline-offset-4 hover:decoration-ink">
                  ask us to order it in
                </Link>
                .
              </p>
            </section>

            <section className="mt-8 rounded-xl border border-line bg-paper p-5" aria-labelledby="author-heading">
              <h2 id="author-heading" className="font-display text-lg font-semibold text-ink">
                About {book.author.name}
              </h2>

              {book.author.bio ? (
                <p className="mt-2 max-w-measure text-sm leading-relaxed text-ink-soft">{book.author.bio}</p>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">We do not have a biography for this author yet.</p>
              )}

              <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-muted">
                {book.author.nationality && <span>{book.author.nationality}</span>}
                <Link
                  href={`/authors/${book.author.slug}`}
                  className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                >
                  All books by {book.author.name}
                </Link>
              </div>
            </section>

            {detail.frequentlyBoughtTogether.length > 0 && (
              <section className="mt-8" aria-labelledby="fbt-heading">
                <h2 id="fbt-heading" className="font-display text-lg font-semibold text-ink">
                  Frequently bought together
                </h2>
                <p className="mt-1 text-xs text-ink-muted">
                  Based on what customers actually ordered alongside this book.
                </p>

                <ul className="mt-4 flex flex-wrap gap-4">
                  {detail.frequentlyBoughtTogether.map((item) => (
                    <li key={item.id} className="w-[140px]">
                      <BookCard book={item} sizes="140px" showQuickAdd={false} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>

      {reviewsEnabled && (
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
          <ReviewSection
            bookId={book.id}
            bookTitle={book.title}
            summary={reviewSummary}
            reviews={reviewsData.items}
            pendingMine={reviewsData.pendingMine}
            signedIn={Boolean(user)}
            hasPurchased={viewerBought}
            canReview={Boolean(user)}
          />
        </div>
      )}

      <div className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6">
        <Suspense fallback={null}>
          {detail.related.length > 0 && (
            <BookShelf
              title="More like this"
              subtitle={book.genre ? `Other ${book.genre.name.toLowerCase()} books we stock` : undefined}
              href={book.genre ? `/genres/${book.genre.slug}` : '/books'}
              books={detail.related}
              savedIds={saved}
            />
          )}

          {detail.authorOtherBooks.length > 0 && (
            <BookShelf
              title={`More from ${book.author.name}`}
              href={`/authors/${book.author.slug}`}
              books={detail.authorOtherBooks}
              savedIds={saved}
            />
          )}

          {detail.alsoBought.length > 0 && (
            <BookShelf title="Readers also bought" subtitle="What went into the same basket" books={detail.alsoBought} savedIds={saved} />
          )}

          {recentlyViewed.length > 0 && <BookShelf title="Recently viewed" books={recentlyViewed} savedIds={saved} />}
        </Suspense>
      </div>
    </>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 border-b border-line/60 pb-2">
      <dt className="w-28 shrink-0 text-ink-muted">{label}</dt>
      <dd className={mono ? 'font-mono text-ink' : 'text-ink'}>{value}</dd>
    </div>
  );
}
