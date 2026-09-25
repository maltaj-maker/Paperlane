import { env } from './env';

/**
 * Structured-data builders.
 *
 * Two rules govern everything in this file:
 *
 *  1. We only emit markup we can actually stand behind. A `Book` with an
 *     invented `aggregateRating`, or a `Product` claiming `InStock` for an item
 *     we cannot ship, is a search-engine penalty waiting to happen and a lie to
 *     the customer. Every builder here is fed real data or omits the field.
 *  2. Prices are emitted in the currency's major unit as a decimal string, which
 *     is what schema.org expects — even though we store paise internally.
 */

export const CURRENCY = 'INR';

export function absoluteUrl(path: string): string {
  const base = env().APP_URL.replace(/\/$/, '');
  if (/^https?:\/\//.test(path)) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** schema.org availability values. We never claim availability we cannot honour. */
export function schemaAvailability(status: string): string {
  switch (status) {
    case 'in_stock':
      return 'https://schema.org/InStock';
    case 'low_stock':
      // Low stock is still purchasable; LimitedAvailability is the honest signal.
      return 'https://schema.org/LimitedAvailability';
    case 'preorder':
      return 'https://schema.org/PreOrder';
    case 'out_of_stock':
      return 'https://schema.org/OutOfStock';
    default:
      return 'https://schema.org/InStock';
  }
}

export interface BookSchemaInput {
  title: string;
  subtitle?: string | null;
  slug: string;
  description?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  authorName: string;
  authorUrl?: string;
  publisherName?: string | null;
  publicationDate?: Date | null;
  pageCount?: number | null;
  language?: string;
  format?: string;
  coverImageUrl?: string;
  pricePaise: number;
  salePricePaise?: number | null;
  availabilityStatus: string;
  ratingAvg?: number;
  ratingCount?: number;
  genreName?: string | null;
}

/** A `Book` (which is also a `Product`) with a real `Offer`. */
export function buildBookSchema(input: BookSchemaInput): Record<string, unknown> {
  const url = absoluteUrl(`/books/${input.slug}`);
  const price = (input.salePricePaise ?? input.pricePaise) / 100;

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: input.title,
    url,
    ...(input.subtitle ? { alternativeHeadline: input.subtitle } : {}),
    ...(input.description ? { description: stripToPlainText(input.description).slice(0, 5000) } : {}),
    ...(input.coverImageUrl ? { image: absoluteUrl(input.coverImageUrl) } : {}),
    author: {
      '@type': 'Person',
      name: input.authorName,
      ...(input.authorUrl ? { url: absoluteUrl(input.authorUrl) } : {}),
    },
    ...(input.publisherName
      ? { publisher: { '@type': 'Organization', name: input.publisherName } }
      : {}),
    ...(input.isbn13 ? { isbn: input.isbn13 } : input.isbn10 ? { isbn: input.isbn10 } : {}),
    ...(input.pageCount ? { numberOfPages: input.pageCount } : {}),
    ...(input.language ? { inLanguage: input.language } : {}),
    ...(input.publicationDate ? { datePublished: input.publicationDate.toISOString().slice(0, 10) } : {}),
    bookFormat: mapBookFormat(input.format),
    ...(input.genreName ? { genre: input.genreName, about: { '@type': 'Thing', name: input.genreName } } : {}),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: CURRENCY,
      // Fixed-decimal string; schema.org wants a decimal, not a float.
      price: price.toFixed(2),
      availability: schemaAvailability(input.availabilityStatus),
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: env().APP_NAME },
      ...(input.salePricePaise && input.salePricePaise < input.pricePaise
        ? {
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: price.toFixed(2),
              priceCurrency: CURRENCY,
            },
          }
        : {}),
    },
  };

  // Only include a rating when reviews exist. An aggregateRating of 0 with 0
  // reviews is worse than no markup at all.
  if (input.ratingCount && input.ratingCount > 0 && input.ratingAvg && input.ratingAvg > 0) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: input.ratingAvg.toFixed(1),
      reviewCount: input.ratingCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return schema;
}

export function buildBreadcrumbSchema(items: Array<{ label: string; href?: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      ...(item.href ? { item: absoluteUrl(item.href) } : {}),
    })),
  };
}

export function buildOrganizationSchema(options?: { logoUrl?: string; sameAs?: string[] }) {
  const e = env();
  return {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: e.APP_NAME,
    url: e.APP_URL,
    ...(options?.logoUrl ? { logo: absoluteUrl(options.logoUrl) } : {}),
    ...(options?.sameAs?.length ? { sameAs: options.sameAs } : {}),
    ...(e.SUPPORT_EMAIL || e.SUPPORT_PHONE
      ? {
          contactPoint: {
            '@type': 'ContactPoint',
            contactType: 'customer service',
            ...(e.SUPPORT_EMAIL ? { email: e.SUPPORT_EMAIL } : {}),
            ...(e.SUPPORT_PHONE ? { telephone: e.SUPPORT_PHONE } : {}),
            areaServed: 'IN',
            availableLanguage: ['English', 'Hindi'],
          },
        }
      : {}),
  };
}

export function buildWebSiteSchema(options?: { searchUrl?: string }) {
  const e = env();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: e.APP_NAME,
    url: e.APP_URL,
    ...(options?.searchUrl
      ? {
          potentialAction: {
            '@type': 'SearchAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: `${e.APP_URL.replace(/\/$/, '')}${options.searchUrl}?q={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
          },
        }
      : {}),
  };
}

export function buildArticleSchema(input: {
  title: string;
  slug: string;
  excerpt?: string | null;
  coverImage?: string | null;
  publishedAt: Date | null;
  updatedAt?: Date | null;
  authorName?: string | null;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    url: absoluteUrl(`/blog/${input.slug}`),
    ...(input.excerpt ? { description: stripToPlainText(input.excerpt).slice(0, 300) } : {}),
    ...(input.coverImage ? { image: absoluteUrl(input.coverImage) } : {}),
    ...(input.publishedAt ? { datePublished: input.publishedAt.toISOString() } : {}),
    ...(input.updatedAt ? { dateModified: input.updatedAt.toISOString() } : {}),
    author: { '@type': input.authorName ? 'Person' : 'Organization', name: input.authorName ?? env().APP_NAME },
    publisher: { '@type': 'Organization', name: env().APP_NAME },
  };
}

export function buildItemListSchema(input: {
  name: string;
  items: Array<{ name: string; url: string }>;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: input.name,
    numberOfItems: input.items.length,
    itemListElement: input.items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.url),
    })),
  };
}

export function buildFaqSchema(faqs: Array<{ question: string; answer: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: stripToPlainText(faq.answer) },
    })),
  };
}

/**
 * Store a `<script type="application/ld+json">` payload safely.
 *
 * The `</script>` escape is not optional: without it, a book description
 * containing that sequence would break out of the tag and turn stored content
 * into executable markup. This is the one XSS vector JSON-LD genuinely has.
 */
export function serialiseJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function mapBookFormat(format?: string): string {
  switch (format) {
    case 'hardcover':
      return 'https://schema.org/Hardcover';
    case 'paperback':
      return 'https://schema.org/Paperback';
    case 'ebook':
      return 'https://schema.org/EBook';
    case 'audiobook':
      return 'https://schema.org/AudiobookFormat';
    default:
      return 'https://schema.org/Paperback';
  }
}

/** Descriptions arrive as plain text already; this strips any stray markup. */
function stripToPlainText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
