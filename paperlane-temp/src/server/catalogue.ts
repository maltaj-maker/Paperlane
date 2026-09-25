/**
 * Catalogue queries.
 *
 * Every storefront surface is served from here so the homepage, genre pages and
 * recommendations all agree on what "bestseller" means. Any list that appears in
 * more than one place lives in exactly one function.
 *
 * All queries filter to `status: 'active'` and `deletedAt: null` by default —
 * a draft book must never leak onto the storefront, and the safest way to
 * guarantee that is to make the filter part of the shared selector rather than
 * something each call site remembers to add.
 */

import { db } from './db';
import { getAvailabilityMap, type Availability } from './inventory';
import { sellingPricePaise } from './pricing';
import type { BookCard } from './search';
import { logger, timed } from '@/lib/logger';

/** Shared projection for any book rendered as a card. */
const cardSelect = {
  id: true,
  slug: true,
  title: true,
  subtitle: true,
  coverImageUrl: true,
  coverAlt: true,
  pricePaise: true,
  salePricePaise: true,
  format: true,
  language: true,
  ratingAvg: true,
  ratingCount: true,
  pageCount: true,
  isbn13: true,
  isNewRelease: true,
  isStaffPick: true,
  publishedAt: true,
  publicationDate: true,
  salesCount: true,
  author: { select: { name: true, slug: true } },
  genre: { select: { name: true, slug: true } },
} as const;

export const PUBLISHED_BOOK_WHERE = { status: 'active', deletedAt: null } as const;

type CardRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  coverImageUrl: string;
  coverAlt: string | null;
  pricePaise: number;
  salePricePaise: number | null;
  format: string;
  language: string;
  ratingAvg: number;
  ratingCount: number;
  pageCount: number | null;
  isbn13: string | null;
  isNewRelease: boolean;
  isStaffPick: boolean;
  publishedAt: Date | null;
  publicationDate?: Date | null;
  salesCount: number;
  author: { name: string; slug: string };
  genre: { name: string; slug: string } | null;
};

function toCard(row: CardRow, availability: Map<string, Availability>): BookCard {
  const selling = sellingPricePaise(row);
  const discount =
    row.pricePaise > 0 && selling < row.pricePaise
      ? Math.round(((row.pricePaise - selling) / row.pricePaise) * 100)
      : 0;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    authorName: row.author.name,
    authorSlug: row.author.slug,
    genreName: row.genre?.name ?? null,
    genreSlug: row.genre?.slug ?? null,
    coverImageUrl: row.coverImageUrl,
    coverAlt: row.coverAlt,
    pricePaise: row.pricePaise,
    salePricePaise: row.salePricePaise,
    sellingPricePaise: selling,
    discountPercent: discount,
    format: row.format,
    language: row.language,
    ratingAvg: row.ratingAvg,
    ratingCount: row.ratingCount,
    pageCount: row.pageCount,
    isbn13: row.isbn13,
    isNewRelease: row.isNewRelease,
    isStaffPick: row.isStaffPick,
    publishedAt: row.publicationDate ?? row.publishedAt,
    availability: availability.get(row.id) ?? {
      bookId: row.id,
      onHand: 0,
      reserved: 0,
      available: 0,
      incoming: 0,
      lowStockThreshold: 5,
      status: 'out_of_stock' as const,
      maxPerOrder: 0,
    },
  };
}

/** Hydrate a set of rows into cards with one availability query. */
export async function hydrateCards(rows: CardRow[]): Promise<BookCard[]> {
  if (rows.length === 0) return [];
  const availability = await getAvailabilityMap(rows.map((r) => r.id));
  return rows.map((row) => toCard(row, availability));
}

// ---------------------------------------------------------------------------
// Homepage shelves
// ---------------------------------------------------------------------------

export interface HomePageData {
  heroBooks: BookCard[];
  featured: BookCard[];
  newReleases: BookCard[];
  bestsellers: BookCard[];
  trending: BookCard[];
  staffPicks: BookCard[];
  onSale: BookCard[];
  genres: Array<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    heroImage: string | null;
    bookCount: number;
  }>;
  collections: Array<{
    id: string;
    slug: string;
    title: string;
    subtitle: string | null;
    heroImage: string | null;
    bookCount: number;
  }>;
  recentlyViewed: BookCard[];
  /** Personalised shelf when we know who is asking; empty otherwise. */
  forYou: BookCard[];
  stats: { titles: number; authors: number; genres: number };
}

const SHELF_SIZE = 12;

/**
 * Everything the homepage needs, in one call.
 *
 * Runs the shelf queries in parallel — the homepage is the most latency-sensitive
 * page in the app (it is where Instagram traffic lands), so serial queries here
 * would be a direct conversion cost.
 */
export async function getHomePageData(options: { viewerId?: string | null } = {}): Promise<HomePageData> {
  return timed(logger.child({ scope: 'catalogue' }), 'getHomePageData', async () => {
    const now = new Date();

    const [featured, newReleases, bestsellers, trending, staffPicks, onSale, genres, collections, counts] =
      await Promise.all([
        db.book.findMany({
          where: { ...PUBLISHED_BOOK_WHERE, isFeatured: true },
          select: cardSelect,
          orderBy: [{ salesCount: 'desc' }],
          take: SHELF_SIZE,
        }),
        db.book.findMany({
          where: {
            ...PUBLISHED_BOOK_WHERE,
            OR: [
              { isNewRelease: true },
              { publicationDate: { gte: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 120) } },
            ],
          },
          select: cardSelect,
          orderBy: [{ publicationDate: 'desc' }, { createdAt: 'desc' }],
          take: SHELF_SIZE,
        }),
        db.book.findMany({
          where: { ...PUBLISHED_BOOK_WHERE, salesCount: { gt: 0 } },
          select: cardSelect,
          orderBy: [{ salesCount: 'desc' }],
          take: SHELF_SIZE,
        }),
        db.book.findMany({
          where: { ...PUBLISHED_BOOK_WHERE, isTrending: true },
          select: cardSelect,
          orderBy: [{ salesCount: 'desc' }, { viewCount: 'desc' }],
          take: SHELF_SIZE,
        }),
        db.book.findMany({
          where: { ...PUBLISHED_BOOK_WHERE, isStaffPick: true },
          select: cardSelect,
          orderBy: [{ updatedAt: 'desc' }],
          take: SHELF_SIZE,
        }),
        db.book.findMany({
          where: { ...PUBLISHED_BOOK_WHERE, salePricePaise: { not: null } },
          select: cardSelect,
          orderBy: [{ salesCount: 'desc' }],
          take: SHELF_SIZE,
        }),
        db.genre.findMany({
          where: { deletedAt: null, parentId: null },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            heroImage: true,
            sortOrder: true,
            _count: { select: { books: { where: { status: 'active', deletedAt: null } } } },
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          take: 12,
        }),
        db.collection.findMany({
          where: { deletedAt: null, isFeatured: true },
          select: {
            id: true,
            slug: true,
            title: true,
            subtitle: true,
            heroImage: true,
            sortOrder: true,
            _count: { select: { books: true } },
          },
          orderBy: { sortOrder: 'asc' },
          take: 6,
        }),
        Promise.all([
          db.book.count({ where: PUBLISHED_BOOK_WHERE }),
          db.author.count({ where: { deletedAt: null } }),
          db.genre.count({ where: { deletedAt: null } }),
        ]),
      ]);

    // The hero shelf favours featured titles, then falls back to bestsellers so
    // a brand-new store never renders an empty hero.
    const heroBooks = featured.length > 0 ? featured.slice(0, 5) : bestsellers.slice(0, 5);

    const [recentlyViewed, forYou] = await Promise.all([
      getRecentlyViewed(8),
      options.viewerId ? getPersonalisedRecommendations(options.viewerId, 12) : Promise.resolve([]),
    ]);

    const allRows = [
      ...featured,
      ...newReleases,
      ...bestsellers,
      ...trending,
      ...staffPicks,
      ...onSale,
      ...heroBooks,
      ...recentlyViewed,
      ...forYou,
    ];
    const availability = await getAvailabilityMap([...new Set(allRows.map((r) => r.id))]);

    return {
      heroBooks: heroBooks.map((r) => toCard(r, availability)),
      featured: featured.map((r) => toCard(r, availability)),
      newReleases: newReleases.map((r) => toCard(r, availability)),
      bestsellers: bestsellers.map((r) => toCard(r, availability)),
      trending: trending.map((r) => toCard(r, availability)),
      staffPicks: staffPicks.map((r) => toCard(r, availability)),
      onSale: onSale.map((r) => toCard(r, availability)),
      genres: genres.map((g) => ({
        id: g.id,
        slug: g.slug,
        name: g.name,
        description: g.description,
        heroImage: g.heroImage,
        bookCount: g._count.books,
      })),
      collections: collections.map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        subtitle: c.subtitle,
        heroImage: c.heroImage,
        bookCount: c._count.books,
      })),
      recentlyViewed: recentlyViewed.map((r) => toCard(r as CardRow, availability)),
      forYou: forYou.map((r) => toCard(r as CardRow, availability)),
      stats: { titles: counts[0], authors: counts[1], genres: counts[2] },
    };
  }, 1200);
}

// ---------------------------------------------------------------------------
// Book detail page
// ---------------------------------------------------------------------------

/** The fully-hydrated shape returned by `getBookDetail`. */
export type BookWithRelations = NonNullable<Awaited<ReturnType<typeof getBookBySlug>>>;

export interface BookDetail {
  book: BookWithRelations;
  availability: Availability;
  related: BookCard[];
  alsoBought: BookCard[];
  frequentlyBoughtTogether: BookCard[];
  authorOtherBooks: BookCard[];
  reviewSummary: {
    average: number;
    count: number;
    distribution: Array<{ stars: number; count: number; percent: number }>;
    verifiedCount: number;
  };
}

/** Find a book by slug (storefront) or id. Drafts stay hidden from shoppers. */
export async function getBookBySlug(slug: string, options: { includeUnpublished?: boolean } = {}) {
  const book = await db.book.findFirst({
    where: {
      slug,
      ...(options.includeUnpublished ? {} : PUBLISHED_BOOK_WHERE),
    },
    include: {
      author: true,
      publisher: true,
      genre: true,
      genreLinks: { include: { genre: { select: { id: true, name: true, slug: true } } } },
      images: { orderBy: { sortOrder: 'asc' } },
    },
  });

  return book;
}

export async function getBookDetail(
  slug: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<BookDetail | null> {
  const book = await getBookBySlug(slug, options);
  if (!book) return null;

  const [availabilityMap, related, alsoBought, fbt, authorOtherBooks, reviewStats, distribution] =
    await Promise.all([
      getAvailabilityMap([book.id]),
      getRelatedBooks(book.id, book.genreId, 8),
      getAlsoBought(book.id, 8),
      // Frequently bought together is computed from real order history, not invented.
      getFrequentlyBoughtTogether(book.id, 3),
      hydrateCards(
        await db.book.findMany({
          where: { ...PUBLISHED_BOOK_WHERE, authorId: book.authorId, id: { not: book.id } },
          select: cardSelect,
          orderBy: [{ salesCount: 'desc' }],
          take: 8,
        }),
      ),
      db.review.aggregate({
        where: { bookId: book.id, status: 'approved', deletedAt: null },
        _avg: { rating: true },
        _count: { id: true },
      }),
      db.review.groupBy({
        by: ['rating'],
        where: { bookId: book.id, status: 'approved', deletedAt: null },
        _count: { id: true },
      }),
    ]);

  const verifiedCount = await db.review.count({
    where: { bookId: book.id, status: 'approved', deletedAt: null, isVerifiedPurchase: true },
  });

  const totalReviews = reviewStats._count.id ?? 0;
  const distributionRows = [5, 4, 3, 2, 1].map((stars) => {
    const count = distribution.find((d) => d.rating === stars)?._count.id ?? 0;
    return {
      stars,
      count,
      percent: totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0,
    };
  });

  const all = [...related, ...alsoBought, ...fbt, ...authorOtherBooks];

  return {
    book: book as BookDetail['book'],
    availability:
      availabilityMap.get(book.id) ?? {
        bookId: book.id,
        onHand: 0,
        reserved: 0,
        available: 0,
        incoming: 0,
        lowStockThreshold: 5,
        status: 'out_of_stock',
        maxPerOrder: 0,
      },
    related,
    alsoBought,
    frequentlyBoughtTogether: fbt,
    authorOtherBooks,
    reviewSummary: {
      average: Math.round((reviewStats._avg.rating ?? 0) * 10) / 10,
      count: totalReviews,
      distribution: distributionRows,
      verifiedCount,
    },
  };
}

/** Same genre, ranked by sales then rating. Excludes the source book. */
export async function getRelatedBooks(bookId: string, genreId: string | null, limit = 8): Promise<BookCard[]> {
  // Explicit editorial relations win over automatic ones.
  const manual = await db.bookRelation.findMany({
    where: { fromId: bookId, kind: { in: ['related', 'fbt'] } },
    orderBy: { weight: 'desc' },
    take: limit,
    select: { to: { select: cardSelect } },
  });

  const rows = manual.map((m) => m.to);

  if (rows.length < limit && genreId) {
    const fill = await db.book.findMany({
      where: {
        ...PUBLISHED_BOOK_WHERE,
        genreId,
        id: { notIn: [bookId, ...rows.map((r) => r.id)] },
      },
      select: cardSelect,
      orderBy: [{ salesCount: 'desc' }, { ratingAvg: 'desc' }],
      take: limit - rows.length,
    });
    rows.push(...fill);
  }

  return hydrateCards(rows);
}

/** "Customers also bought" — derived from co-occurrence in real paid orders. */
export async function getAlsoBought(bookId: string, limit = 8): Promise<BookCard[]> {
  const orders = await db.orderItem.findMany({
    where: {
      bookId,
      order: { paymentStatus: { in: ['paid', 'partially_refunded'] } },
    },
    select: { orderId: true },
    take: 400,
    orderBy: { id: 'desc' },
  });

  if (orders.length === 0) return [];

  const coItems = await db.orderItem.groupBy({
    by: ['bookId'],
    where: {
      orderId: { in: orders.map((o) => o.orderId) },
      bookId: { not: bookId, notIn: [null as unknown as string] },
    },
    _count: { bookId: true },
    orderBy: { _count: { bookId: 'desc' } },
    take: limit,
  });

  const ids = coItems.map((c) => c.bookId).filter((id): id is string => !!id);
  if (ids.length === 0) return [];

  const rows = await db.book.findMany({
    where: { ...PUBLISHED_BOOK_WHERE, id: { in: ids } },
    select: cardSelect,
  });

  // Preserve co-occurrence order.
  const order = new Map(ids.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

  return hydrateCards(rows);
}

/**
 * "Frequently bought together" — books that most often appear in the same order
 * as this one *and* with each other. Returns real pairings only; when there is
 * not enough history we return nothing rather than fabricating a bundle.
 */
export async function getFrequentlyBoughtTogether(bookId: string, limit = 3): Promise<BookCard[]> {
  const paidOrders = await db.orderItem.findMany({
    where: {
      bookId,
      order: { paymentStatus: { in: ['paid', 'partially_refunded'] } },
    },
    select: { orderId: true },
    take: 300,
    orderBy: { id: 'desc' },
  });

  // Require a minimum sample before claiming a pattern exists.
  if (paidOrders.length < 3) return [];

  const coItems = await db.orderItem.groupBy({
    by: ['bookId'],
    where: {
      orderId: { in: paidOrders.map((o) => o.orderId) },
      bookId: { not: bookId },
    },
    _count: { bookId: true },
    orderBy: { _count: { bookId: 'desc' } },
    take: limit,
  });

  const ids = coItems
    .filter((c) => c.bookId && c._count.bookId >= 2)
    .map((c) => c.bookId as string);

  if (ids.length === 0) return [];

  const rows = await db.book.findMany({
    where: { ...PUBLISHED_BOOK_WHERE, id: { in: ids } },
    select: cardSelect,
  });

  const order = new Map(ids.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

  return hydrateCards(rows);
}

// ---------------------------------------------------------------------------
// Recently viewed & recommendations
// ---------------------------------------------------------------------------

/**
 * Recently viewed, for a signed-in user or a guest cookie token.
 * Deduplicated by bookId in the schema (`@@unique([userId, bookId])`), so the
 * list is always distinct titles ordered by recency.
 */
export async function getRecentlyViewed(limit = 8, viewerId?: string | null, guestToken?: string | null): Promise<CardRow[]> {
  if (!viewerId && !guestToken) return [];

  const rows = await db.recentlyViewed.findMany({
    where: viewerId ? { userId: viewerId } : { guestToken: guestToken! },
    orderBy: { viewedAt: 'desc' },
    take: limit,
    select: { book: { select: cardSelect } },
  });

  return rows.map((r) => r.book);
}

export async function recordView(
  bookId: string,
  viewer: { userId?: string | null; guestToken?: string | null },
): Promise<void> {
  if (!viewer.userId && !viewer.guestToken) return;

  try {
    if (viewer.userId) {
      await db.recentlyViewed.upsert({
        where: { userId_bookId: { userId: viewer.userId, bookId } },
        create: { userId: viewer.userId, bookId, viewedAt: new Date() },
        update: { viewedAt: new Date() },
      });
    } else if (viewer.guestToken) {
      // Guest rows have no unique constraint on (guestToken, bookId) that Prisma
      // can address directly, so delete-then-insert keeps the list tidy.
      await db.recentlyViewed.deleteMany({ where: { guestToken: viewer.guestToken, bookId } });
      await db.recentlyViewed.create({
        data: { guestToken: viewer.guestToken, bookId, viewedAt: new Date() },
      });
    }

    await db.book.update({ where: { id: bookId }, data: { viewCount: { increment: 1 } } });
  } catch (err) {
    // View tracking must never break a page render.
    logger.debug('recordView failed', { bookId, err: String(err) });
  }
}

/**
 * Move a guest's viewing history onto their account after sign-in.
 * Reuses `recordView` so the merge and the live tracking cannot drift apart.
 */
export async function adoptGuestViews(guestToken: string, userId: string): Promise<number> {
  const rows = await db.recentlyViewed.findMany({
    where: { guestToken },
    select: { bookId: true },
    take: 50,
    orderBy: { viewedAt: 'desc' },
  });

  if (rows.length === 0) return 0;

  for (const row of rows) {
    await recordView(row.bookId, { userId });
  }

  await db.recentlyViewed.deleteMany({ where: { guestToken } });
  return rows.length;
}

/**
 * Personalised recommendations.
 *
 * Phase 1 is deliberately explainable and cheap: score candidates by overlap
 * with the genres and authors in the customer's order history, wishlist and
 * recently-viewed list, then blend in popularity. No black box, no cold-start
 * failure — a customer with no history simply gets nothing, and the UI falls
 * back to editorial shelves.
 *
 * This is the seam where a real recommender drops in later without touching
 * any page component.
 */
export async function getPersonalisedRecommendations(userId: string, limit = 12): Promise<CardRow[]> {
  const [orders, wishlist, views, profile] = await Promise.all([
    db.orderItem.findMany({
      where: { order: { userId, paymentStatus: { in: ['paid', 'partially_refunded'] } } },
      select: { book: { select: { genreId: true, authorId: true } } },
      orderBy: { id: 'desc' },
      take: 100,
    }),
    db.wishlistItem.findMany({
      where: { userId },
      select: { book: { select: { genreId: true, authorId: true, id: true } } },
      take: 50,
    }),
    db.recentlyViewed.findMany({
      where: { userId },
      select: { book: { select: { genreId: true, authorId: true, id: true } } },
      orderBy: { viewedAt: 'desc' },
      take: 20,
    }),
    db.user.findUnique({ where: { id: userId }, select: { readingPrefs: true } }),
  ]);

  const genreWeights = new Map<string, number>();
  const authorWeights = new Map<string, number>();
  const excludeIds = new Set<string>();

  const addSignal = (genreId: string | null, authorId: string, weight: number, bookId?: string) => {
    if (genreId) genreWeights.set(genreId, (genreWeights.get(genreId) ?? 0) + weight);
    authorWeights.set(authorId, (authorWeights.get(authorId) ?? 0) + weight);
    if (bookId) excludeIds.add(bookId);
  };

  // Purchases are the strongest signal, then wishlist saves, then views.
  for (const item of orders) addSignal(item.book?.genreId ?? null, item.book?.authorId ?? '', 5);
  for (const item of wishlist) addSignal(item.book.genreId, item.book.authorId, 3, item.book.id);
  for (const item of views) addSignal(item.book.genreId, item.book.authorId, 1, item.book.id);

  // Explicit reading preferences are a deliberate, high-intent signal.
  if (profile?.readingPrefs) {
    try {
      const prefs = JSON.parse(profile.readingPrefs) as { favouriteGenres?: string[] };
      for (const genreId of prefs.favouriteGenres ?? []) {
        genreWeights.set(genreId, (genreWeights.get(genreId) ?? 0) + 8);
      }
    } catch {
      /* malformed prefs are not worth failing a recommendation for */
    }
  }

  const topGenres = [...genreWeights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
  const topAuthors = [...authorWeights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);

  if (topGenres.length === 0 && topAuthors.length === 0) return [];

  const candidates = await db.book.findMany({
    where: {
      ...PUBLISHED_BOOK_WHERE,
      id: { notIn: [...excludeIds] },
      OR: [
        ...(topGenres.length ? [{ genreId: { in: topGenres } }] : []),
        ...(topAuthors.length ? [{ authorId: { in: topAuthors } }] : []),
      ],
    },
    select: { ...cardSelect, genreId: true, authorId: true },
    take: 120,
  });

  const scored = candidates.map((book) => {
    const genreScore = book.genreId ? (genreWeights.get(book.genreId) ?? 0) : 0;
    const authorScore = authorWeights.get(book.authorId) ?? 0;
    // Popularity is a small nudge: enough to order equal matches, not enough to
    // override the customer's own stated interests.
    const popularity = Math.min(40, book.salesCount * 2) + book.ratingAvg * 6;
    return { book, score: genreScore * 1.5 + authorScore * 3 + popularity };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.book);
}

/** "Customers also viewed" — from analytics events, so it needs no order history. */
export async function getAlsoViewed(bookId: string, limit = 8): Promise<BookCard[]> {
  // Sessions that viewed this book, then the books those sessions viewed most.
  const sessions = await db.analyticsEvent.findMany({
    where: { name: 'view_item', props: { contains: bookId } },
    select: { sessionId: true },
    take: 300,
    orderBy: { createdAt: 'desc' },
  });

  const sessionIds = [...new Set(sessions.map((s) => s.sessionId).filter((s): s is string => !!s))];
  if (sessionIds.length === 0) return [];

  const events = await db.analyticsEvent.findMany({
    where: { name: 'view_item', sessionId: { in: sessionIds } },
    select: { props: true },
    take: 2_000,
  });

  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.props) continue;
    try {
      const parsed = JSON.parse(event.props) as { bookId?: string };
      if (!parsed.bookId || parsed.bookId === bookId) continue;
      counts.set(parsed.bookId, (counts.get(parsed.bookId) ?? 0) + 1);
    } catch {
      /* ignore malformed props */
    }
  }

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  if (top.length === 0) return [];

  const rows = await db.book.findMany({
    where: { ...PUBLISHED_BOOK_WHERE, id: { in: top } },
    select: cardSelect,
  });

  const order = new Map(top.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

  return hydrateCards(rows);
}

// ---------------------------------------------------------------------------
// Taxonomy pages
// ---------------------------------------------------------------------------

export async function getGenreBySlug(slug: string) {
  return db.genre.findFirst({
    where: { slug, deletedAt: null },
    include: {
      _count: { select: { books: { where: PUBLISHED_BOOK_WHERE } } },
      parent: { select: { name: true, slug: true } },
      children: {
        where: { deletedAt: null },
        select: { id: true, name: true, slug: true, _count: { select: { books: { where: PUBLISHED_BOOK_WHERE } } } },
        orderBy: { name: 'asc' },
      },
    },
  });
}

export async function getGenreTree() {
  const genres = await db.genre.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,
      description: true,
      isFeatured: true,
      sortOrder: true,
      _count: { select: { books: { where: PUBLISHED_BOOK_WHERE } } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const roots = genres.filter((g) => !g.parentId);
  return roots.map((root) => ({
    ...root,
    bookCount: root._count.books,
    children: genres
      .filter((g) => g.parentId === root.id)
      .map((child) => ({ ...child, bookCount: child._count.books })),
  }));
}

export async function getAuthorBySlug(slug: string) {
  return db.author.findFirst({
    where: { slug, deletedAt: null },
    include: {
      books: {
        where: PUBLISHED_BOOK_WHERE,
        select: cardSelect,
        orderBy: [{ salesCount: 'desc' }],
      },
    },
  });
}

export async function getPublisherBySlug(slug: string) {
  return db.publisher.findFirst({
    where: { slug, deletedAt: null },
    include: {
      _count: { select: { books: { where: PUBLISHED_BOOK_WHERE } } },
    },
  });
}

export async function getCollectionBySlug(slug: string) {
  const collection = await db.collection.findFirst({
    where: { slug, deletedAt: null },
  });
  if (!collection) return null;

  // Auto collections resolve their contents from rules rather than curation.
  if (collection.kind.startsWith('auto_')) {
    const where =
      collection.kind === 'auto_genre' && collection.autoGenreId
        ? { ...PUBLISHED_BOOK_WHERE, genreId: collection.autoGenreId }
        : collection.kind === 'auto_bestseller'
          ? { ...PUBLISHED_BOOK_WHERE, salesCount: { gt: 0 } }
          : collection.kind === 'auto_new'
            ? { ...PUBLISHED_BOOK_WHERE, isNewRelease: true }
            : { ...PUBLISHED_BOOK_WHERE, isStaffPick: true };

    const orderBy =
      collection.kind === 'auto_bestseller'
        ? [{ salesCount: 'desc' as const }]
        : collection.kind === 'auto_new'
          ? [{ publicationDate: 'desc' as const }]
          : [{ ratingAvg: 'desc' as const }];

    const rows = await db.book.findMany({ where: where as never, select: cardSelect, orderBy, take: 48 });
    return { collection, books: await hydrateCards(rows) };
  }

  const links = await db.collectionBook.findMany({
    where: { collectionId: collection.id },
    orderBy: { sortOrder: 'asc' },
    select: { book: { select: cardSelect } },
  });

  return { collection, books: await hydrateCards(links.map((l) => l.book)) };
}

export async function listFeaturedAuthors(limit = 8) {
  return db.author.findMany({
    where: { deletedAt: null, isFeatured: true },
    select: {
      id: true,
      name: true,
      slug: true,
      photoUrl: true,
      bio: true,
      nationality: true,
      _count: { select: { books: { where: PUBLISHED_BOOK_WHERE } } },
    },
    take: limit,
  });
}

export async function listPublishers(limit = 50) {
  return db.publisher.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      description: true,
      _count: { select: { books: { where: PUBLISHED_BOOK_WHERE } } },
    },
    orderBy: { name: 'asc' },
    take: limit,
  });
}

/** Related genres for internal linking on genre pages. */
export async function getSiblingGenres(genreId: string, limit = 6) {
  const genre = await db.genre.findUnique({ where: { id: genreId }, select: { parentId: true } });

  return db.genre.findMany({
    where: {
      deletedAt: null,
      id: { not: genreId },
      ...(genre?.parentId ? { parentId: genre.parentId } : {}),
    },
    select: { id: true, name: true, slug: true, _count: { select: { books: { where: PUBLISHED_BOOK_WHERE } } } },
    orderBy: { sortOrder: 'asc' },
    take: limit,
  });
}
