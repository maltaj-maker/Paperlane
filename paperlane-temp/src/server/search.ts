/**
 * Catalogue search.
 *
 * Design
 * ------
 * Phase 1 (this file) is a hybrid: a SQL pre-filter pulls a bounded candidate
 * set, then scoring happens in memory. That keeps relevance ranking expressive —
 * title beats author beats description, popularity breaks ties — while staying
 * fast for a catalogue in the tens of thousands.
 *
 * Typo tolerance works in two layers:
 *   1. Prefix matching per token, so "illusi" finds "Illusions" as you type.
 *   2. A Levenshtein fallback against a cached vocabulary of title words and
 *      author surnames, so "illusins" still finds it. The vocabulary is small
 *      (one entry per distinct word) and cached with a TTL.
 *
 * Scaling path: swap `fetchCandidates` for a Postgres `tsvector` + `pg_trgm`
 * query (or Meilisearch/Typesense) behind the same signature. The scoring layer
 * above it does not change. This is documented rather than pre-built because
 * premature search infrastructure is a classic way to stall a launch.
 */

import { db } from './db';
import { getAvailabilityMap, type Availability } from './inventory';
import { sellingPricePaise } from './pricing';
import { logger, timed } from '@/lib/logger';
import { looksLikeIsbn, normaliseForSearch, significantTokens, tokenise, typoBudget, levenshtein, isValidIsbn } from '@/lib/text';

export interface SearchFilters {
  genre?: string[];
  author?: string[];
  publisher?: string[];
  language?: string[];
  format?: string[];
  collection?: string;
  minPricePaise?: number;
  maxPricePaise?: number;
  minRating?: number;
  inStockOnly?: boolean;
  onSaleOnly?: boolean;
  publishedAfter?: Date;
  publishedBefore?: Date;
  isbn?: string;
}

export type SortOption =
  | 'relevance'
  | 'popularity'
  | 'newest'
  | 'price_asc'
  | 'price_desc'
  | 'rating'
  | 'discount';

export interface SearchParams extends SearchFilters {
  q?: string;
  sort?: SortOption;
  page?: number;
  pageSize?: number;
  /** Include draft/archived titles. Admin previews only — never the storefront. */
  includeUnpublished?: boolean;
}

export interface BookCard {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  authorName: string;
  authorSlug: string;
  genreName: string | null;
  genreSlug: string | null;
  coverImageUrl: string;
  coverAlt: string | null;
  pricePaise: number;
  salePricePaise: number | null;
  sellingPricePaise: number;
  discountPercent: number;
  format: string;
  language: string;
  ratingAvg: number;
  ratingCount: number;
  pageCount: number | null;
  isbn13: string | null;
  isNewRelease: boolean;
  isStaffPick: boolean;
  publishedAt: Date | null;
  availability: Availability;
  /** Relevance score. Only meaningful within a single search response. */
  score?: number;
  /** Which field matched, for "matched in author" style hints. */
  matchType?: 'title' | 'author' | 'isbn' | 'genre' | 'description' | 'publisher';
}

export interface SearchFacet {
  value: string;
  label: string;
  count: number;
}

export interface SearchResult {
  items: BookCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  tookMs: number;
  /** Present when the query was auto-corrected. */
  didYouMean: string | null;
  /** True when results came from fuzzy matching rather than exact terms. */
  fuzzyApplied: boolean;
  facets: {
    genres: SearchFacet[];
    authors: SearchFacet[];
    publishers: SearchFacet[];
    languages: SearchFacet[];
    formats: SearchFacet[];
    priceRanges: Array<{ key: string; label: string; minPaise: number; maxPaise: number | null; count: number }>;
    ratings: SearchFacet[];
    availability: SearchFacet[];
  };
  /** Echo of the normalised filters actually applied, for building UI state. */
  appliedFilters: SearchFilters;
}

const MAX_CANDIDATES = 400;
const DEFAULT_PAGE_SIZE = 24;

const bookCardSelect = {
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
  isbn10: true,
  isNewRelease: true,
  isStaffPick: true,
  salesCount: true,
  publishedAt: true,
  publicationDate: true,
  status: true,
  deletedAt: true,
  description: true,
  author: { select: { id: true, name: true, slug: true } },
  genre: { select: { id: true, name: true, slug: true } },
  publisher: { select: { id: true, name: true, slug: true } },
} as const;

type BookRow = Awaited<ReturnType<typeof fetchCandidates>>[number];

/**
 * Build the SQL WHERE clause for a search.
 *
 * Deliberately over-fetches (tokens are OR-ed), because scoring decides the final
 * order. Precision comes from the scorer, recall comes from here.
 */
function buildWhere(params: SearchParams, terms: string[], isbn: string | null) {
  const and: Record<string, unknown>[] = [];

  if (!params.includeUnpublished) {
    and.push({ status: 'active' });
    and.push({ deletedAt: null });
  }

  // --- Free-text ---
  if (terms.length > 0 || isbn) {
    const or: Record<string, unknown>[] = [];

    if (isbn) {
      or.push({ isbn13: isbn });
      or.push({ isbn10: isbn });
    }

    for (const term of terms) {
      or.push({ title: { contains: term } });
      or.push({ subtitle: { contains: term } });
      or.push({ author: { name: { contains: term } } });
      or.push({ genre: { name: { contains: term } } });
      or.push({ publisher: { name: { contains: term } } });
      or.push({ isbn13: { contains: term } });
      or.push({ description: { contains: term } });
    }

    and.push({ OR: or });
  }

  // --- Filters ---
  if (params.genre?.length) and.push({ genre: { slug: { in: params.genre } } });
  if (params.author?.length) and.push({ author: { slug: { in: params.author } } });
  if (params.publisher?.length) and.push({ publisher: { slug: { in: params.publisher } } });
  if (params.language?.length) and.push({ language: { in: params.language } });
  if (params.format?.length) and.push({ format: { in: params.format } });

  if (params.collection) {
    and.push({ collections: { some: { collection: { slug: params.collection } } } });
  }

  if (params.publishedAfter || params.publishedBefore) {
    and.push({
      publicationDate: {
        ...(params.publishedAfter ? { gte: params.publishedAfter } : {}),
        ...(params.publishedBefore ? { lte: params.publishedBefore } : {}),
      },
    });
  }

  if (params.isbn) {
    const parsed = isValidIsbn(params.isbn);
    and.push({ OR: [{ isbn13: parsed.normalised }, { isbn10: parsed.normalised }] });
  }

  if (params.minRating) and.push({ ratingAvg: { gte: params.minRating } });
  if (params.onSaleOnly) and.push({ salePricePaise: { not: null } });

  // Price filtering happens post-scoring because the effective price is
  // min(salePrice, price) and SQLite cannot express that in a WHERE clause
  // portably. The candidate cap keeps this cheap.

  return and.length === 1 ? and[0]! : { AND: and };
}

async function fetchCandidates(params: SearchParams, terms: string[], isbn: string | null) {
  const sortOrder = mapSortToSql(params.sort);

  return db.book.findMany({
    where: buildWhere(params, terms, isbn) as never,
    select: bookCardSelect,
    orderBy: sortOrder,
    take: MAX_CANDIDATES,
  });
}

function mapSortToSql(sort: SortOption | undefined) {
  switch (sort) {
    case 'newest':
      return [{ publicationDate: 'desc' as const }, { createdAt: 'desc' as const }];
    case 'price_asc':
      return [{ pricePaise: 'asc' as const }];
    case 'price_desc':
      return [{ pricePaise: 'desc' as const }];
    case 'rating':
      return [{ ratingAvg: 'desc' as const }, { ratingCount: 'desc' as const }];
    case 'popularity':
      return [{ salesCount: 'desc' as const }, { ratingAvg: 'desc' as const }];
    case 'discount':
      return [{ salePricePaise: 'asc' as const }];
    default:
      // Relevance is computed in memory; a popularity pre-sort gives the scorer
      // a sensible tie-break order and keeps the candidate set useful.
      return [{ salesCount: 'desc' as const }, { ratingAvg: 'desc' as const }];
  }
}

// ---------------------------------------------------------------------------
// Availability + scoring
// ---------------------------------------------------------------------------

interface ScoreInput {
  row: BookRow;
  terms: string[];
  normalisedQuery: string;
  isbn: string | null;
  fuzzyTerms: Map<string, { term: string; distance: number }>;
}

function scoreRow({ row, terms, normalisedQuery, isbn, fuzzyTerms }: ScoreInput): { score: number; matchType: BookCard['matchType'] } {
  let score = 0;
  let matchType: BookCard['matchType'] = 'title';

  const title = normaliseForSearch(row.title);
  const subtitle = normaliseForSearch(row.subtitle ?? '');
  const author = normaliseForSearch(row.author.name);
  const genre = normaliseForSearch(row.genre?.name ?? '');
  const publisher = normaliseForSearch(row.publisher?.name ?? '');
  const description = normaliseForSearch(row.description);

  // ISBN is the strongest possible signal.
  if (isbn) {
    if (row.isbn13 === isbn || row.isbn10 === isbn) return { score: 10_000, matchType: 'isbn' };
    if (row.isbn13?.includes(isbn)) {
      score += 2_000;
      matchType = 'isbn';
    }
  }

  // Exact full-title match.
  if (normalisedQuery && title === normalisedQuery) {
    score += 5_000;
    matchType = 'title';
  } else if (normalisedQuery && title.startsWith(normalisedQuery)) {
    score += 2_500;
    matchType = 'title';
  }

  for (const term of terms) {
    const typed = term;

    if (title === typed) score += 1_500;
    else if (title.startsWith(typed)) score += 900;
    else if (new RegExp(`\\b${escapeRegex(typed)}`).test(title)) score += 600;
    else if (title.includes(typed)) score += 350;

    if (subtitle.includes(typed)) score += 120;

    // Authors matter nearly as much as titles — people search "rushdie".
    if (author === typed) score += 1_100;
    else if (author.startsWith(typed)) score += 700;
    else if (new RegExp(`\\b${escapeRegex(typed)}`).test(author)) score += 500;
    else if (author.includes(typed)) score += 280;

    if (genre.includes(typed)) score += 150;
    if (publisher.includes(typed)) score += 90;
    if (description.includes(typed)) score += 25;

    // Fuzzy contribution: a typo'd exact title match should beat a weak
    // substring match on something unrelated.
    const fuzzy = fuzzyTerms.get(term);
    if (fuzzy) {
      const penalty = fuzzy.distance === 1 ? 0.55 : 0.35;
      if (title.includes(fuzzy.term)) score += Math.round(700 * penalty);
      else if (author.includes(fuzzy.term)) score += Math.round(500 * penalty);
      else if (genre.includes(fuzzy.term)) score += Math.round(120 * penalty);
    }
  }

  if (score === 0) return { score: 0, matchType: undefined };

  // Popularity + quality tie-breakers. Deliberately sub-dominant so they never
  // override a genuine textual match, but they settle ties sensibly.
  score += Math.min(300, row.salesCount * 3);
  score += row.ratingAvg * 30;
  score += Math.min(120, row.ratingCount * 2);
  if (row.isStaffPick) score += 60;
  if (row.isNewRelease) score += 30;

  // Determine the dominant match source for the UI hint.
  if (terms.some((t) => author.includes(t))) matchType = 'author';
  else if (terms.some((t) => genre.includes(t))) matchType = 'genre';

  return { score, matchType };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Typo tolerance vocabulary
// ---------------------------------------------------------------------------

interface Vocabulary {
  words: string[];
  builtAt: number;
}

let vocabulary: Vocabulary | null = null;
const VOCAB_TTL_MS = 10 * 60 * 1000;

/**
 * Build a vocabulary of distinct title words and author surnames.
 * Cached for 10 minutes; invalidated explicitly by catalogue writes.
 */
async function getVocabulary(): Promise<string[]> {
  if (vocabulary && Date.now() - vocabulary.builtAt < VOCAB_TTL_MS) {
    return vocabulary.words;
  }

  const [titles, authors] = await Promise.all([
    db.book.findMany({
      where: { status: 'active', deletedAt: null },
      select: { title: true, subtitle: true },
      take: 5_000,
    }),
    db.author.findMany({ where: { deletedAt: null }, select: { name: true }, take: 2_000 }),
  ]);

  const set = new Set<string>();
  for (const row of titles) {
    for (const token of tokenise(row.title)) if (token.length > 2) set.add(token);
    if (row.subtitle) for (const token of tokenise(row.subtitle)) if (token.length > 2) set.add(token);
  }
  for (const row of authors) {
    for (const token of tokenise(row.name)) if (token.length > 2) set.add(token);
  }

  vocabulary = { words: [...set], builtAt: Date.now() };
  return vocabulary.words;
}

export function invalidateSearchVocabulary(): void {
  vocabulary = null;
}

/**
 * For each query term that produced no exact matches, find the closest
 * vocabulary word within the typo budget. Returns the corrected terms.
 */
async function buildFuzzyTerms(unmatched: string[]): Promise<{ map: Map<string, { term: string; distance: number }>; corrected: string[] }> {
  const map = new Map<string, { term: string; distance: number }>();
  const corrected: string[] = [];
  if (unmatched.length === 0) return { map, corrected };

  const words = await getVocabulary();

  for (const term of unmatched) {
    const budget = typoBudget(term);
    if (budget === 0) continue;

    let best: { word: string; distance: number } | null = null;

    for (const word of words) {
      if (Math.abs(word.length - term.length) > budget) continue;
      const distance = levenshtein(term, word, budget);
      if (distance <= budget && (!best || distance < best.distance)) {
        best = { word, distance };
        if (distance === 1) break;
      }
    }

    if (best) {
      map.set(term, { term: best.word, distance: best.distance });
      corrected.push(best.word);
    } else {
      corrected.push(term);
    }
  }

  return { map, corrected };
}

// ---------------------------------------------------------------------------
// Main search
// ---------------------------------------------------------------------------

export async function searchBooks(params: SearchParams): Promise<SearchResult> {
  const started = Date.now();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(60, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

  const rawQuery = (params.q ?? '').trim();
  const isbnCandidate = looksLikeIsbn(rawQuery) ? isValidIsbn(rawQuery).normalised : null;
  const terms = rawQuery ? significantTokens(rawQuery) : [];
  const normalisedQuery = normaliseForSearch(rawQuery);

  return timed(
    logger.child({ scope: 'search' }),
    'searchBooks',
    async () => {
      // 1. Exact-ish pass.
      let rows = await fetchCandidates(params, terms, isbnCandidate);

      // 2. Score.
      let scored = rows
        .map((row) => ({ row, ...scoreRow({ row, terms, normalisedQuery, isbn: isbnCandidate, fuzzyTerms: new Map() }) }))
        .filter((entry) => entry.score > 0 || terms.length === 0);

      // 3. Diagnostics: which terms matched nothing at all?
      let fuzzyApplied = false;
      let didYouMean: string | null = null;

      if (terms.length > 0) {
        const matchedTerms = new Set<string>();
        for (const entry of scored) {
          const haystack = normaliseForSearch(
            `${entry.row.title} ${entry.row.subtitle ?? ''} ${entry.row.author.name} ${entry.row.genre?.name ?? ''}`,
          );
          for (const term of terms) if (haystack.includes(term)) matchedTerms.add(term);
        }

        const unmatched = terms.filter((t) => !matchedTerms.has(t));

        if (unmatched.length > 0) {
          // 4. Fuzzy recovery.
          const { map, corrected } = await buildFuzzyTerms(unmatched);

          if (map.size > 0) {
            fuzzyApplied = true;

            // Re-query with corrected terms to widen recall.
            const correctedTerms = [...new Set(terms.map((t) => map.get(t)?.term ?? t))];
            const extraRows = await fetchCandidates(params, correctedTerms, isbnCandidate);
            const seen = new Set(rows.map((r) => r.id));
            const additions = extraRows.filter((r) => !seen.has(r.id));
            rows = [...rows, ...additions];

            scored = rows
              .map((row) => ({ row, ...scoreRow({ row, terms, normalisedQuery, isbn: isbnCandidate, fuzzyTerms: map }) }))
              .filter((entry) => entry.score > 0);
          }

          // Offer a correction only when we actually recovered something.
          const suggestion = corrected.join(' ').trim();
          if (suggestion && suggestion !== normalisedQuery && (map.size > 0 || scored.length === 0)) {
            didYouMean = suggestion;
          }
        }
      }

      // 5. Post-filters that SQL cannot express portably.
      let filtered = scored;

      if (params.minPricePaise !== undefined || params.maxPricePaise !== undefined) {
        filtered = filtered.filter(({ row }) => {
          const price = sellingPricePaise(row);
          if (params.minPricePaise !== undefined && price < params.minPricePaise) return false;
          if (params.maxPricePaise !== undefined && price > params.maxPricePaise) return false;
          return true;
        });
      }

      // 6. Availability — fetched for the filtered set only.
      const availability = await getAvailabilityMap(filtered.map((f) => f.row.id));

      if (params.inStockOnly) {
        filtered = filtered.filter(({ row }) => (availability.get(row.id)?.available ?? 0) > 0);
      }

      // 7. Sort.
      if (!params.sort || params.sort === 'relevance') {
        filtered.sort((a, b) => b.score - a.score);
      } else if (params.sort === 'popularity') {
        filtered.sort((a, b) => b.row.salesCount - a.row.salesCount || b.score - a.score);
      } else if (params.sort === 'newest') {
        filtered.sort(
          (a, b) =>
            (b.row.publicationDate?.getTime() ?? b.row.publishedAt?.getTime() ?? 0) -
            (a.row.publicationDate?.getTime() ?? a.row.publishedAt?.getTime() ?? 0),
        );
      } else if (params.sort === 'price_asc') {
        filtered.sort((a, b) => sellingPricePaise(a.row) - sellingPricePaise(b.row));
      } else if (params.sort === 'price_desc') {
        filtered.sort((a, b) => sellingPricePaise(b.row) - sellingPricePaise(a.row));
      } else if (params.sort === 'rating') {
        filtered.sort((a, b) => b.row.ratingAvg - a.row.ratingAvg || b.row.ratingCount - a.row.ratingCount);
      } else if (params.sort === 'discount') {
        filtered.sort((a, b) => discountOf(b.row) - discountOf(a.row));
      }

      const total = filtered.length;
      const pageSlice = filtered.slice((page - 1) * pageSize, page * pageSize);

      const items: BookCard[] = pageSlice.map(({ row, score, matchType }) => {
        const selling = sellingPricePaise(row);
        const discount = row.pricePaise > 0 && selling < row.pricePaise
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
          availability: availability.get(row.id) ?? emptyAvailability(row.id),
          score,
          matchType,
        };
      });

      // 8. Facets are computed over the pre-price-filter set so options do not
      //    vanish as the customer narrows down (a well-known filter-UX trap).
      const facets = buildFacets(scored, availability);

      return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        tookMs: Date.now() - started,
        didYouMean,
        fuzzyApplied,
        facets,
        appliedFilters: {
          genre: params.genre,
          author: params.author,
          publisher: params.publisher,
          language: params.language,
          format: params.format,
          collection: params.collection,
          minPricePaise: params.minPricePaise,
          maxPricePaise: params.maxPricePaise,
          minRating: params.minRating,
          inStockOnly: params.inStockOnly,
          onSaleOnly: params.onSaleOnly,
        },
      };
    },
    800,
  );
}

function discountOf(row: BookRow): number {
  const selling = sellingPricePaise(row);
  return row.pricePaise > 0 && selling < row.pricePaise
    ? ((row.pricePaise - selling) / row.pricePaise) * 100
    : 0;
}

function emptyAvailability(bookId: string): Availability {
  return {
    bookId,
    onHand: 0,
    reserved: 0,
    available: 0,
    incoming: 0,
    lowStockThreshold: 5,
    status: 'out_of_stock',
    maxPerOrder: 0,
  };
}

/** Facet counts. Bounded to the candidate set, which is the honest trade-off. */
function buildFacets(
  scored: Array<{ row: BookRow; score: number }>,
  availability: Map<string, Availability>,
): SearchResult['facets'] {
  const genres = new Map<string, SearchFacet>();
  const authors = new Map<string, SearchFacet>();
  const publishers = new Map<string, SearchFacet>();
  const languages = new Map<string, SearchFacet>();
  const formats = new Map<string, SearchFacet>();
  const ratings = new Map<string, SearchFacet>();
  const availabilityFacets = new Map<string, SearchFacet>();

  const priceBuckets = [
    { key: 'under200', label: 'Under ₹200', minPaise: 0, maxPaise: 20_000, count: 0 },
    { key: '200to499', label: '₹200 – ₹499', minPaise: 20_000, maxPaise: 49_999, count: 0 },
    { key: '500to999', label: '₹500 – ₹999', minPaise: 50_000, maxPaise: 99_999, count: 0 },
    { key: 'over1000', label: '₹1,000 and above', minPaise: 100_000, maxPaise: null as number | null, count: 0 },
  ];

  const bump = (map: Map<string, SearchFacet>, value: string, label: string) => {
    const existing = map.get(value);
    if (existing) existing.count += 1;
    else map.set(value, { value, label, count: 1 });
  };

  for (const { row } of scored) {
    if (row.genre) bump(genres, row.genre.slug, row.genre.name);
    bump(authors, row.author.slug, row.author.name);
    if (row.publisher) bump(publishers, row.publisher.slug, row.publisher.name);
    bump(languages, row.language, row.language);
    bump(formats, row.format, row.format.replace(/^\w/, (c) => c.toUpperCase()));

    const price = sellingPricePaise(row);
    for (const bucket of priceBuckets) {
      if (price >= bucket.minPaise && (bucket.maxPaise === null || price <= bucket.maxPaise)) {
        bucket.count += 1;
        break;
      }
    }

    if (row.ratingAvg >= 4.5) bump(ratings, '4.5', '4.5 and above');
    else if (row.ratingAvg >= 4) bump(ratings, '4', '4.0 and above');
    else if (row.ratingAvg >= 3) bump(ratings, '3', '3.0 and above');

    const avail = availability.get(row.id);
    if ((avail?.available ?? 0) > 0) bump(availabilityFacets, 'in_stock', 'In stock');
    else bump(availabilityFacets, 'out_of_stock', 'Out of stock');

    if (row.salePricePaise !== null && row.salePricePaise < row.pricePaise) {
      bump(availabilityFacets, 'on_sale', 'On sale');
    }
  }

  const sortByCount = (map: Map<string, SearchFacet>) =>
    [...map.values()].sort((a, b) => b.count - a.count);

  return {
    genres: sortByCount(genres),
    authors: sortByCount(authors).slice(0, 15),
    publishers: sortByCount(publishers).slice(0, 15),
    languages: sortByCount(languages),
    formats: sortByCount(formats),
    priceRanges: priceBuckets,
    ratings: [...ratings.values()].sort((a, b) => Number(b.value) - Number(a.value)),
    availability: sortByCount(availabilityFacets),
  };
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

export interface AutocompleteSuggestion {
  type: 'book' | 'author' | 'genre' | 'isbn' | 'query';
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
  imageUrl: string | null;
  /** True when this suggestion came from typo recovery. */
  corrected?: boolean;
}

export interface AutocompleteResult {
  suggestions: AutocompleteSuggestion[];
  didYouMean: string | null;
  tookMs: number;
}

/**
 * Typeahead. Returns mixed suggestions (books, authors, genres) so a single
 * input serves every intent — which is what people expect on a phone.
 */
export async function autocomplete(query: string, limit = 8): Promise<AutocompleteResult> {
  const started = Date.now();
  const trimmed = query.trim();

  if (trimmed.length < 2) {
    return { suggestions: [], didYouMean: null, tookMs: 0 };
  }

  // Direct ISBN entry gets priority: a barcode scan should jump straight to the book.
  if (looksLikeIsbn(trimmed)) {
    const parsed = isValidIsbn(trimmed);
    const book = await db.book.findFirst({
      where: {
        status: 'active',
        deletedAt: null,
        OR: [{ isbn13: parsed.normalised }, { isbn10: parsed.normalised }],
      },
      select: {
        id: true,
        title: true,
        slug: true,
        coverImageUrl: true,
        author: { select: { name: true } },
      },
    });

    if (book) {
      return {
        suggestions: [
          {
            type: 'isbn',
            id: book.id,
            label: book.title,
            sublabel: `ISBN ${parsed.normalised} · ${book.author.name}`,
            href: `/books/${book.slug}`,
            imageUrl: book.coverImageUrl,
          },
        ],
        didYouMean: null,
        tookMs: Date.now() - started,
      };
    }
  }

  const terms = significantTokens(trimmed);
  const firstTerm = terms[0] ?? normaliseForSearch(trimmed);

  const [books, authors, genres] = await Promise.all([
    db.book.findMany({
      where: {
        status: 'active',
        deletedAt: null,
        OR: [
          { title: { contains: firstTerm } },
          { subtitle: { contains: firstTerm } },
          { author: { name: { contains: firstTerm } } },
          { isbn13: { contains: normaliseForSearch(trimmed) } },
        ],
      },
      select: {
        id: true,
        title: true,
        slug: true,
        coverImageUrl: true,
        salesCount: true,
        author: { select: { name: true } },
      },
      orderBy: [{ salesCount: 'desc' }],
      take: limit + 4,
    }),
    db.author.findMany({
      where: { deletedAt: null, name: { contains: firstTerm } },
      select: { id: true, name: true, slug: true, photoUrl: true, _count: { select: { books: true } } },
      take: 4,
    }),
    db.genre.findMany({
      where: { deletedAt: null, name: { contains: firstTerm } },
      select: { id: true, name: true, slug: true },
      take: 3,
    }),
  ]);

  const suggestions: AutocompleteSuggestion[] = [];

  for (const book of books.slice(0, limit)) {
    suggestions.push({
      type: 'book',
      id: book.id,
      label: book.title,
      sublabel: book.author.name,
      href: `/books/${book.slug}`,
      imageUrl: book.coverImageUrl,
    });
  }

  for (const author of authors) {
    suggestions.push({
      type: 'author',
      id: author.id,
      label: author.name,
      sublabel: `${author._count.books} ${author._count.books === 1 ? 'book' : 'books'}`,
      href: `/authors/${author.slug}`,
      imageUrl: author.photoUrl,
    });
  }

  for (const genre of genres) {
    suggestions.push({
      type: 'genre',
      id: genre.id,
      label: genre.name,
      sublabel: 'Browse genre',
      href: `/genres/${genre.slug}`,
      imageUrl: null,
    });
  }

  // Typo recovery for the typeahead.
  let didYouMean: string | null = null;
  if (suggestions.length < 3) {
    const { map, corrected } = await buildFuzzyTerms([firstTerm]);
    if (map.size > 0) {
      const correctedTerm = map.get(firstTerm)!.term;
      didYouMean = corrected.join(' ');

      const fuzzyBooks = await db.book.findMany({
        where: {
          status: 'active',
          deletedAt: null,
          OR: [{ title: { contains: correctedTerm } }, { author: { name: { contains: correctedTerm } } }],
        },
        select: {
          id: true,
          title: true,
          slug: true,
          coverImageUrl: true,
          author: { select: { name: true } },
        },
        orderBy: [{ salesCount: 'desc' }],
        take: 5,
      });

      for (const book of fuzzyBooks) {
        if (suggestions.some((s) => s.id === book.id)) continue;
        suggestions.push({
          type: 'book',
          id: book.id,
          label: book.title,
          sublabel: book.author.name,
          href: `/books/${book.slug}`,
          imageUrl: book.coverImageUrl,
          corrected: true,
        });
      }
    }
  }

  // Always offer the "see all results" affordance last.
  suggestions.push({
    type: 'query',
    id: 'all',
    label: `See all results for “${trimmed}”`,
    sublabel: null,
    href: `/search?q=${encodeURIComponent(trimmed)}`,
    imageUrl: null,
  });

  return {
    suggestions: suggestions.slice(0, limit + 1),
    didYouMean,
    tookMs: Date.now() - started,
  };
}
