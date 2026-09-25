/**
 * Content management: banners, FAQs, testimonials, blog, legal documents.
 *
 * All storefront content is database-driven so the shop owner can change
 * promotions, hero copy and FAQ answers without a deploy. Scheduling
 * (`startsAt`/`endsAt`, draft/scheduled/published) is enforced on read, so a
 * banner can be queued for a sale next week and simply appear.
 */

import { db } from './db';
import { BANNER_PLACEMENT, BLOG_STATUS } from '@/lib/constants';
import { readingMinutes, toExcerpt } from '@/lib/text';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Banners & announcements
// ---------------------------------------------------------------------------

export interface ResolvedBanner {
  id: string;
  key: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  placement: string;
  theme: string | null;
}

/**
 * Active banners for a placement. Time-windowed and ordered.
 * Returns [] rather than throwing when the DB is unreachable, so a content
 * outage degrades the homepage instead of breaking it.
 */
export async function getBanners(placement: string, limit = 5): Promise<ResolvedBanner[]> {
  const now = new Date();
  try {
    const banners = await db.banner.findMany({
      where: {
        placement,
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { sortOrder: 'asc' },
      take: limit,
      select: {
        id: true,
        key: true,
        title: true,
        subtitle: true,
        body: true,
        imageUrl: true,
        ctaLabel: true,
        ctaHref: true,
        placement: true,
        theme: true,
      },
    });
    return banners;
  } catch (err) {
    logger.error('getBanners failed', { placement, err });
    return [];
  }
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: string;
}

export async function getFaqs(category?: string): Promise<FaqItem[]> {
  return db.faq.findMany({
    where: { isActive: true, ...(category ? { category } : {}) },
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    select: { id: true, question: true, answer: true, category: true },
  });
}

export async function getFaqCategories(): Promise<Array<{ category: string; count: number }>> {
  const rows = await db.faq.groupBy({
    by: ['category'],
    where: { isActive: true },
    _count: { id: true },
  });
  return rows.map((r) => ({ category: r.category, count: r._count.id }));
}

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

/**
 * Customer testimonials for the homepage.
 *
 * Anything seeded for a demo carries `isDemo: true` and the UI labels it as
 * sample content. Shipping invented social proof as if it were real reviews is
 * both dishonest and, in several jurisdictions, unlawful advertising.
 */
export async function getTestimonials(limit = 6) {
  return db.testimonial.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    take: limit,
    select: {
      id: true,
      name: true,
      role: true,
      quote: true,
      rating: true,
      avatarUrl: true,
      isDemo: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Blog / editorial
// ---------------------------------------------------------------------------

export interface BlogListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImage: string | null;
  category: string;
  authorName: string | null;
  publishedAt: Date | null;
  readingMinutes: number;
  tags: string[];
}

function toBlogListItem(row: {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  coverImage: string | null;
  category: string;
  authorName: string | null;
  publishedAt: Date | null;
  readingMinutes: number | null;
  tags: string | null;
  author?: { name: string } | null;
}): BlogListItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? toExcerpt(row.body),
    coverImage: row.coverImage,
    category: row.category,
    authorName: row.author?.name ?? row.authorName,
    publishedAt: row.publishedAt,
    readingMinutes: row.readingMinutes ?? readingMinutes(row.body),
    tags: parseTags(row.tags),
  };
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Public post visibility: published and not in the future. */
/** A function (not a const) so `new Date()` is evaluated per call, not frozen
 *  at module load — a long-running server would otherwise compare against a
 *  stale "now" and hide newly published posts. */
function publishedPostWhere() {
  return {
    status: BLOG_STATUS.PUBLISHED,
    deletedAt: null,
    OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
  };
}

export async function listBlogPosts(options: { category?: string; tag?: string; page?: number; pageSize?: number; includeUnpublished?: boolean } = {}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, options.pageSize ?? 9);

  const where = options.includeUnpublished
    ? { deletedAt: null, ...(options.category ? { category: options.category } : {}) }
    : { ...publishedPostWhere(), ...(options.category ? { category: options.category } : {}) };

  const [rows, total] = await Promise.all([
    db.blogPost.findMany({
      where: options.tag ? { ...where, tags: { contains: options.tag } } : where,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { author: { select: { name: true } } },
    }),
    db.blogPost.count({ where }),
  ]);

  return {
    items: rows.map(toBlogListItem),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getBlogPost(slug: string, options: { includeUnpublished?: boolean } = {}) {
  const post = await db.blogPost.findFirst({
    where: {
      slug,
      deletedAt: null,
      ...(options.includeUnpublished ? {} : { status: BLOG_STATUS.PUBLISHED }),
    },
    include: { author: { select: { name: true, avatarUrl: true } } },
  });

  if (!post) return null;
  return { ...post, tags: parseTags(post.tags) };
}

/** Related posts by shared category, for internal linking and SEO. */
export async function getRelatedPosts(slug: string, category: string, limit = 3) {
  const rows = await db.blogPost.findMany({
    where: { ...publishedPostWhere(), slug: { not: slug }, category },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    include: { author: { select: { name: true } } },
  });
  return rows.map(toBlogListItem);
}

export async function getBlogCategories() {
  const rows = await db.blogPost.groupBy({
    by: ['category'],
    where: { status: BLOG_STATUS.PUBLISHED, deletedAt: null },
    _count: { id: true },
  });
  return rows.map((r) => ({ category: r.category, count: r._count.id }));
}

/** Increment a view counter without blocking the response. */
export async function recordBlogView(id: string): Promise<void> {
  db.blogPost
    .update({ where: { id }, data: { viewCount: { increment: 1 } } })
    .catch((err) => logger.debug('blog view increment failed', { err: String(err) }));
}

// ---------------------------------------------------------------------------
// Legal documents
// ---------------------------------------------------------------------------

/**
 * Legal copy is stored as data so the owner can replace it with copy reviewed by
 * their own lawyer. Every seeded document carries `requiresLegalReview: true`
 * and the UI displays that notice — we do not present generated policy text as
 * if it were legal advice.
 */
export async function getLegalDocument(slug: string) {
  return db.legalDocument.findUnique({ where: { slug } });
}

export async function listLegalDocuments() {
  return db.legalDocument.findMany({
    orderBy: { title: 'asc' },
    select: { slug: true, title: true, version: true, requiresLegalReview: true, effectiveAt: true, updatedAt: true },
  });
}

// ---------------------------------------------------------------------------
// Site settings & feature flags
// ---------------------------------------------------------------------------

const settingsCache = new Map<string, { value: string; expires: number }>();
const SETTINGS_TTL_MS = 60_000;

/** Read a single setting, cached briefly. Returns the fallback if unset. */
export async function getSetting(key: string, fallback: string | null = null): Promise<string | null> {
  const cached = settingsCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const row = await db.setting.findUnique({ where: { key }, select: { value: true } });
  const value = row?.value ?? fallback;
  if (value !== null) settingsCache.set(key, { value, expires: Date.now() + SETTINGS_TTL_MS });
  return value;
}

export async function getSettingsGroup(group: string) {
  return db.setting.findMany({ where: { group }, orderBy: { key: 'asc' } });
}

export async function getAllSettings() {
  return db.setting.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
}

/** Settings explicitly marked safe to expose to the storefront. */
export async function getPublicSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany({ where: { isPublic: true }, select: { key: true, value: true } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function invalidateSettingsCache(): void {
  settingsCache.clear();
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

const flagCache = new Map<string, { enabled: boolean; expires: number }>();
const FLAG_TTL_MS = 30_000;

/**
 * Is a feature on?
 *
 * Flags live in the database so a launch can be toggled without a deploy, and
 * fall back to the environment variable of the same name so a fresh install
 * behaves sensibly before the seed runs.
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const cached = flagCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.enabled;

  try {
    const flag = await db.featureFlag.findUnique({ where: { key }, select: { enabled: true, rolloutPercent: true } });
    if (flag) {
      // Percentage rollout: stable per process, adequate for gradual release.
      const enabled =
        flag.enabled && (flag.rolloutPercent >= 100 || Math.random() * 100 < flag.rolloutPercent);
      flagCache.set(key, { enabled, expires: Date.now() + FLAG_TTL_MS });
      return enabled;
    }
  } catch (err) {
    logger.warn('feature flag lookup failed', { key, err: String(err) });
  }

  const fromEnv = process.env[`FEATURE_${key.toUpperCase()}`];
  const enabled = fromEnv ? ['true', '1', 'yes', 'on'].includes(fromEnv.toLowerCase()) : false;
  flagCache.set(key, { enabled, expires: Date.now() + FLAG_TTL_MS });
  return enabled;
}

export async function getAllFeatureFlags() {
  return db.featureFlag.findMany({ orderBy: { key: 'asc' } });
}

export function invalidateFlagCache(): void {
  flagCache.clear();
}

// ---------------------------------------------------------------------------
// Announcements (thin wrapper over banners for the top strip)
// ---------------------------------------------------------------------------

export async function getAnnouncement(): Promise<ResolvedBanner | null> {
  const banners = await getBanners(BANNER_PLACEMENT.ANNOUNCEMENT, 1);
  return banners[0] ?? null;
}
