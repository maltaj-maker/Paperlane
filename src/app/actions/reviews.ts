'use server';

/**
 * Review actions.
 *
 * Moderation policy, stated once here because it is a business decision rather
 * than a technical one: every review lands in `pending` and is published only
 * after a human approves it. That is slower than auto-publishing, but it is the
 * only way to keep a small shop's reviews credible — one spam wave published
 * automatically undoes months of trust.
 *
 * A review is marked as a verified purchase only when the reviewer genuinely has
 * a paid order containing that book. We never set that flag from the client, and
 * we never show the badge without it.
 */

import { revalidatePath } from 'next/cache';

import { db } from '@/server/db';
import { getCurrentUser } from '@/server/auth';
import { consume, RATE_LIMITS, limitKey } from '@/server/rate-limit';
import { getClientIpForLimit } from '@/server/request-context';
import { reviewSchema, reviewReportSchema } from '@/lib/validation';
import { recordAudit } from '@/server/audit';
import { AUDIT_ACTION } from '@/lib/constants';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  fromError,
  zodFieldErrors,
  formString,
  formNumber,
  formBoolean,
  type ActionState,
} from './types';

export interface ReviewSubmitResult {
  reviewId: string;
}

export async function submitReviewAction(
  _prev: ActionState<ReviewSubmitResult>,
  formData: FormData,
): Promise<ActionState<ReviewSubmitResult>> {
  const ip = await getClientIpForLimit();

  try {
    const user = await getCurrentUser();
    if (!user) {
      return fail('Please sign in to write a review.', { code: 'UNAUTHENTICATED' });
    }

    // Honeypot: a hidden field that only a bot will fill.
    if (formString(formData, 'website')) {
      // Pretend it worked. Telling a bot it failed only teaches it to try harder.
      logger.warn('review honeypot triggered', { userId: user.id });
      return ok({ reviewId: 'filtered' }, 'Thanks — your review is with our team.');
    }

    const limit = await consume('CONTACT', limitKey('review:user', user.id), {
      limit: 5,
      windowSeconds: 3_600,
    });
    if (!limit.allowed) {
      return fail('You have submitted several reviews recently. Please try again later.', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
    }

    const parsed = reviewSchema.safeParse({
      bookId: formString(formData, 'bookId'),
      rating: formNumber(formData, 'rating'),
      title: formString(formData, 'title'),
      body: formString(formData, 'body'),
      website: formString(formData, 'website'),
    });

    if (!parsed.success) {
      return fail('Please check your review and try again.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    const { bookId, rating, title, body } = parsed.data;

    const book = await db.book.findFirst({
      where: { id: bookId, deletedAt: null, status: 'active' },
      select: { id: true, slug: true },
    });
    if (!book) return fail('We could not find that title.', { code: 'NOT_FOUND' });

    // Verified purchase: a paid order containing this book, belonging to this user.
    const paidOrderItem = await db.orderItem.findFirst({
      where: {
        bookId,
        order: {
          userId: user.id,
          paymentStatus: { in: ['paid', 'partially_refunded'] },
        },
      },
      select: { orderId: true },
      orderBy: { order: { placedAt: 'desc' } },
    });

    const existing = await db.review.findUnique({
      where: { userId_bookId: { userId: user.id, bookId } },
      select: { id: true, status: true },
    });

    const review = await db.review.upsert({
      where: { userId_bookId: { userId: user.id, bookId } },
      create: {
        userId: user.id,
        bookId,
        rating,
        title: title ?? null,
        body,
        // Re-submitting resets to pending: an edited review must be re-moderated,
        // otherwise someone could get a clean review approved and then edit it.
        status: 'pending',
        isVerifiedPurchase: Boolean(paidOrderItem),
        orderId: paidOrderItem?.orderId ?? null,
      },
      update: {
        rating,
        title: title ?? null,
        body,
        status: 'pending',
        isVerifiedPurchase: Boolean(paidOrderItem),
        orderId: paidOrderItem?.orderId ?? null,
      },
      select: { id: true },
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTION.REVIEW_SUBMIT,
      entityType: 'review',
      entityId: review.id,
      summary: existing ? 'Review updated (returned to moderation)' : 'Review submitted',
      // `after` is the redacted snapshot the audit log keeps; never raw PII.
      after: { bookId, rating, verified: Boolean(paidOrderItem), status: 'pending' },
    });

    revalidatePath(`/books/${book.slug}`);

    return ok(
      { reviewId: review.id },
      existing
        ? 'Thanks — your updated review is back with our team for a quick check.'
        : 'Thanks for the review. It will appear once we have read it — usually within a day.',
    );
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Helpful votes
// ---------------------------------------------------------------------------

export async function markReviewHelpfulAction(reviewId: string): Promise<ActionState<{ count: number }>> {
  try {
    const user = await getCurrentUser();
    if (!user) return fail('Sign in to mark reviews as helpful.', { code: 'UNAUTHENTICATED' });

    const review = await db.review.findFirst({
      where: { id: reviewId, status: 'approved', deletedAt: null },
      select: { id: true, userId: true, helpfulCount: true },
    });
    if (!review) return fail('That review is no longer available.', { code: 'NOT_FOUND' });

    // Voting on your own review is meaningless and easy to abuse.
    if (review.userId === user.id) {
      return fail('You cannot mark your own review as helpful.', { code: 'FORBIDDEN' });
    }

    const existing = await db.reviewVote.findUnique({
      where: { reviewId_userId: { reviewId, userId: user.id } },
      select: { id: true },
    });

    if (existing) {
      await db.reviewVote.delete({ where: { id: existing.id } });
      const updated = await db.review.update({
        where: { id: reviewId },
        data: { helpfulCount: { decrement: 1 } },
        select: { helpfulCount: true },
      });
      return ok({ count: Math.max(0, updated.helpfulCount) }, 'Vote removed.');
    }

    await db.reviewVote.create({ data: { reviewId, userId: user.id } });
    const updated = await db.review.update({
      where: { id: reviewId },
      data: { helpfulCount: { increment: 1 } },
      select: { helpfulCount: true },
    });

    return ok({ count: updated.helpfulCount }, 'Thanks — that helps other readers.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export async function reportReviewAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const parsed = reviewReportSchema.safeParse({
      reviewId: formString(formData, 'reviewId'),
      reason: formString(formData, 'reason'),
      detail: formString(formData, 'detail'),
    });

    if (!parsed.success) {
      return fail('Please choose a reason for the report.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    const user = await getCurrentUser();
    const review = await db.review.findFirst({
      where: { id: parsed.data.reviewId, deletedAt: null },
      select: { id: true, reportCount: true },
    });
    if (!review) return fail('That review is no longer available.', { code: 'NOT_FOUND' });

    await db.$transaction([
      db.reviewReport.create({
        data: {
          reviewId: review.id,
          userId: user?.id ?? null,
          reason: parsed.data.reason,
          detail: parsed.data.detail ?? null,
        },
      }),
      db.review.update({
        where: { id: review.id },
        // Three open reports auto-hide a review pending moderation. It is a
        // reversible safety net, not a deletion — nothing is destroyed.
        data: {
          reportCount: { increment: 1 },
          ...(review.reportCount + 1 >= 3 ? { status: 'hidden' as const } : {}),
        },
      }),
    ]);

    // Always the same response, so a reporter cannot learn anything from it.
    return ok(undefined, 'Thank you — our team will take a look.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Helpful display data
// ---------------------------------------------------------------------------

export interface ReviewWithAuthor {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  createdAt: Date;
  authorName: string;
  /** True when the current viewer has already voted this helpful. */
  viewerFoundHelpful: boolean;
  isOwn: boolean;
}

/**
 * Approved reviews for a book, plus the viewer's own pending review (so they can
 * see that it was received rather than wondering whether the form worked).
 */
export async function getReviewsForBook(
  bookId: string,
  options: { page?: number; pageSize?: number; sort?: 'recent' | 'helpful' | 'rating' } = {},
): Promise<{ items: ReviewWithAuthor[]; total: number; pendingMine: ReviewWithAuthor | null }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(20, Math.max(1, options.pageSize ?? 8));
  const sort = options.sort ?? 'helpful';

  const user = await getCurrentUser().catch(() => null);

  const where = { bookId, status: 'approved', deletedAt: null };

  const [rows, total] = await Promise.all([
    db.review.findMany({
      where,
      orderBy:
        sort === 'recent'
          ? [{ createdAt: 'desc' }]
          : sort === 'rating'
            ? [{ rating: 'desc' }, { helpfulCount: 'desc' }]
            : [{ helpfulCount: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        isVerifiedPurchase: true,
        helpfulCount: true,
        createdAt: true,
        userId: true,
        user: { select: { name: true } },
        votes: user ? { where: { userId: user.id }, select: { id: true } } : false,
      },
    }),
    db.review.count({ where }),
  ]);

  const items: ReviewWithAuthor[] = rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    isVerifiedPurchase: row.isVerifiedPurchase,
    helpfulCount: row.helpfulCount,
    createdAt: row.createdAt,
    // Reviews are shown under a first name plus initial — enough to feel human,
    // not enough to identify a customer.
    authorName: abbreviateName(row.user.name),
    viewerFoundHelpful: Array.isArray(row.votes) ? row.votes.length > 0 : false,
    isOwn: user ? row.userId === user.id : false,
  }));

  let pendingMine: ReviewWithAuthor | null = null;

  if (user) {
    const mine = await db.review.findFirst({
      where: { bookId, userId: user.id, status: { in: ['pending', 'rejected', 'hidden'] } },
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        isVerifiedPurchase: true,
        helpfulCount: true,
        createdAt: true,
      },
    });

    if (mine) {
      pendingMine = {
        ...mine,
        authorName: 'You',
        viewerFoundHelpful: false,
        isOwn: true,
      };
    }
  }

  return { items, total, pendingMine };
}

/** True when the viewer has a paid order containing this book. */
export async function hasPurchased(bookId: string): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user) return false;

    const item = await db.orderItem.findFirst({
      where: { bookId, order: { userId: user.id, paymentStatus: { in: ['paid', 'partially_refunded'] } } },
      select: { id: true },
    });

    return Boolean(item);
  } catch {
    return false;
  }
}

export async function hasReviewed(bookId: string): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user) return false;

    const review = await db.review.findUnique({
      where: { userId_bookId: { userId: user.id, bookId } },
      select: { id: true },
    });

    return Boolean(review);
  } catch {
    return false;
  }
}

function abbreviateName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A reader';
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
}
