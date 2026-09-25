'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';

import { submitReviewAction, markReviewHelpfulAction, reportReviewAction } from '@/app/actions/reviews';
import { IDLE } from '@/app/actions/types';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { Rating, RatingBreakdown, RatingInput } from '@/components/ui/Rating';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Feedback';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/cn';
import { useToast } from '@/components/ui/Toast';

export interface DisplayReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  createdAt: Date | string;
  authorName: string;
  viewerFoundHelpful: boolean;
  isOwn: boolean;
}

/**
 * Reviews: summary, list and the write-a-review form.
 *
 * Two credibility decisions are visible here:
 *  - The "Verified purchase" badge only ever appears when the server confirmed a
 *    paid order containing this book. We never show it optimistically.
 *  - A review the customer has written stays visible to them with a "waiting to
 *    be published" label. Otherwise people submit and assume it vanished, then
 *    send us an email about it — or worse, leave a one-star review about the
 *    review process.
 */
export function ReviewSection({
  bookId,
  bookTitle,
  summary,
  reviews,
  pendingMine,
  canReview,
  hasPurchased,
  signedIn,
}: {
  bookId: string;
  bookTitle: string;
  summary: {
    average: number;
    count: number;
    distribution: Array<{ stars: number; count: number; percent: number }>;
    verifiedCount: number;
  };
  reviews: DisplayReview[];
  pendingMine: DisplayReview | null;
  canReview: boolean;
  hasPurchased: boolean;
  signedIn: boolean;
}) {
  const [writing, setWriting] = useState(false);

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="reviews-heading" className="font-display text-xl font-semibold text-ink sm:text-2xl">
          Reader reviews
        </h2>

        {canReview && !writing && (
          <Button variant="secondary" size="sm" onClick={() => setWriting(true)}>
            Write a review
          </Button>
        )}
      </div>

      {/* Summary */}
      {summary.count > 0 ? (
        <div className="mt-5 rounded-xl border border-line bg-paper p-5">
          <RatingBreakdown
            distribution={summary.distribution}
            total={summary.count}
            average={summary.average}
          />

          {summary.verifiedCount > 0 && (
            <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
              {summary.verifiedCount} of these {summary.count === 1 ? 'review comes' : 'reviews come'} from
              customers who bought the book here.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">
          No reviews yet — be the first to say what you thought of it.
        </p>
      )}

      {/* Write a review */}
      {writing && (
        <ReviewForm
          bookId={bookId}
          bookTitle={bookTitle}
          hasPurchased={hasPurchased}
          onDone={() => setWriting(false)}
        />
      )}

      {/* The customer's own review, whatever its moderation state */}
      {pendingMine && (
        <div className="mt-5">
          <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
            Your review
          </p>
          <ReviewCard review={pendingMine} showStatus isFirst={false} />
        </div>
      )}

      {/* Published reviews */}
      {reviews.length > 0 && (
        <ul className="mt-6 divide-y divide-line border-t border-line">
          {reviews.map((review, index) => (
            <li key={review.id}>
              <ReviewCard review={review} isFirst={index === 0} />
            </li>
          ))}
        </ul>
      )}

      {!signedIn && summary.count === 0 && (
        <EmptyState
          title="Sign in to leave a review"
          description="Reviews from verified buyers carry the most weight with other readers."
          action={{ label: 'Sign in', href: '/login' }}
          className="mt-6"
        />
      )}
    </section>
  );
}

function ReviewCard({
  review,
  showStatus = false,
  isFirst = false,
}: {
  review: DisplayReview;
  showStatus?: boolean;
  isFirst?: boolean;
}) {
  const [helpful, setHelpful] = useState(review.viewerFoundHelpful);
  const [count, setCount] = useState(review.helpfulCount);
  const [reporting, setReporting] = useState(false);
  const toast = useToast();

  const toggleHelpful = async () => {
    const result = await markReviewHelpfulAction(review.id);
    if (result.ok && result.data) {
      setHelpful((prev) => !prev);
      setCount(result.data.count);
    } else if (!result.ok) {
      toast.error('Could not record that', result.error);
    }
  };

  return (
    <article className={cn('py-5', showStatus && 'rounded-xl border border-dashed border-line bg-paper-soft px-4')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Rating value={review.rating} size="sm" showValue={false} />

        {review.isVerifiedPurchase && (
          <Badge tone="success" size="sm">
            Verified purchase
          </Badge>
        )}

        {showStatus && (
          <Badge tone="warning" size="sm">
            Awaiting publication
          </Badge>
        )}

        <span className="text-xs text-ink-faint">{formatDate(review.createdAt)}</span>
      </div>

      {review.title && (
        <h3 className="mt-2 font-display text-base font-semibold text-ink">{review.title}</h3>
      )}

      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{review.body}</p>

      <div className="mt-3 flex items-center gap-4">
        <p className="text-xs font-medium text-ink-muted">
          {review.authorName}
          {isFirst && review.isVerifiedPurchase ? ' · bought from us' : ''}
        </p>

        {!review.isOwn && !showStatus && (
          <>
            <button
              type="button"
              onClick={toggleHelpful}
              aria-pressed={helpful}
              className={cn(
                'inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                helpful
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-line text-ink-muted hover:border-ink-faint hover:text-ink',
              )}
            >
              Helpful
              {count > 0 && <span className="tabular-nums">({count})</span>}
            </button>

            <button
              type="button"
              onClick={() => setReporting((prev) => !prev)}
              className="text-xs text-ink-faint underline decoration-line underline-offset-4 transition-colors hover:text-ink-muted"
            >
              Report
            </button>
          </>
        )}
      </div>

      {reporting && <ReportForm reviewId={review.id} onDone={() => setReporting(false)} />}
    </article>
  );
}

function ReportForm({ reviewId, onDone }: { reviewId: string; onDone: () => void }) {
  const [state, formAction] = useActionState(reportReviewAction, IDLE);

  if (state.ok) {
    return (
      <Alert tone="success" className="mt-3" live="polite">
        {state.message ?? 'Thank you — our team will take a look.'}
      </Alert>
    );
  }

  return (
    <form action={formAction} className="mt-3 rounded-lg border border-line bg-paper-soft p-3">
      <input type="hidden" name="reviewId" value={reviewId} />

      <Select
        label="Why are you reporting this review?"
        id={`reason-${reviewId}`}
        name="reason"
        required
        options={[
          { value: 'spam', label: 'Spam or advertising' },
          { value: 'abuse', label: 'Abusive or hateful' },
          { value: 'spoiler', label: 'Contains spoilers' },
          { value: 'irrelevant', label: 'Not about this book' },
          { value: 'other', label: 'Something else' },
        ]}
      />

      <Textarea
        label="Anything else?"
        id={`detail-${reviewId}`}
        name="detail"
        hint="Optional"
        rows={2}
        maxLength={500}
        wrapClassName="mt-3"
      />

      <div className="mt-3 flex items-center gap-2">
        <ReportSubmit />
        <button
          type="button"
          onClick={onDone}
          className="min-h-[40px] rounded-full px-4 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ReportSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[40px] rounded-full bg-ink px-4 text-sm font-semibold text-paper disabled:opacity-60"
    >
      {pending ? 'Sending…' : 'Report review'}
    </button>
  );
}

/**
 * The review form.
 *
 * The honeypot field is hidden with CSS rather than `type="hidden"` — a hidden
 * input is invisible to the bots we are trying to catch, whereas a visually
 * hidden text field is not.
 */
function ReviewForm({
  bookId,
  bookTitle,
  hasPurchased,
  onDone,
}: {
  bookId: string;
  bookTitle: string;
  hasPurchased: boolean;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(submitReviewAction, IDLE);
  const [rating, setRating] = useState(0);

  if (state.ok) {
    return (
      <Alert tone="success" title="Thank you" className="mt-5" live="polite">
        {state.message}
      </Alert>
    );
  }

  return (
    <form action={formAction} className="mt-5 rounded-xl border border-line bg-paper p-5">
      <h3 className="font-display text-lg font-semibold text-ink">Review “{bookTitle}”</h3>

      {hasPurchased ? (
        <p className="mt-1 text-xs text-success">
          We found your order for this book — your review will carry the verified badge.
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-muted">
          We could not find an order for this title on your account, so this will show as an unverified
          review.{' '}
          <Link href="/contact" className="underline decoration-line underline-offset-4">
            Bought it elsewhere?
          </Link>
        </p>
      )}

      {!state.ok && state.error && (
        <Alert tone="danger" className="mt-4" live="polite">
          {state.error}
        </Alert>
      )}

      <input type="hidden" name="bookId" value={bookId} />

      {/* Honeypot: real people never see or fill this. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0">
        <label htmlFor="review-website">Website</label>
        <input id="review-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mt-4">
        <RatingInput
          name="rating"
          value={rating}
          onChange={setRating}
          required
          error={!state.ok ? state.fieldErrors?.rating?.[0] : undefined}
        />
      </div>

      <Input
        label="Headline"
        id="review-title"
        name="title"
        hint="Optional — a few words that sum it up"
        maxLength={120}
        placeholder="Worth every evening"
        wrapClassName="mt-4"
        error={!state.ok ? state.fieldErrors?.title : undefined}
      />

      <Textarea
        label="Your review"
        id="review-body"
        name="body"
        hint="At least 20 characters. No spoilers without warning, please."
        rows={6}
        minLength={20}
        maxLength={4000}
        required
        wrapClassName="mt-4"
        error={!state.ok ? state.fieldErrors?.body : undefined}
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <ReviewSubmit />
        <button
          type="button"
          onClick={onDone}
          className="min-h-[44px] rounded-full px-5 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
        Reviews are read by a person before they appear. That keeps the spam out and the genuine
        criticism in.
      </p>
    </form>
  );
}

function ReviewSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[44px] rounded-full bg-brand-700 px-6 text-sm font-semibold text-paper transition-colors hover:bg-brand-600 disabled:opacity-60"
    >
      {pending ? 'Sending…' : 'Submit review'}
    </button>
  );
}
