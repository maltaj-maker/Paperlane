'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { toggleWishlistAction } from '@/app/actions/wishlist';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

/**
 * Wishlist toggle.
 *
 * The pressed state is optimistic and reverts if the server disagrees, so the
 * heart responds instantly on a slow connection. `aria-pressed` communicates the
 * toggle state to assistive technology — a heart icon alone conveys nothing.
 */
export function WishlistButton({
  bookId,
  bookTitle,
  initialSaved = false,
  size = 'md',
  withLabel = false,
  className,
}: {
  bookId: string;
  bookTitle: string;
  initialSaved?: boolean;
  size?: 'sm' | 'md' | 'lg';
  withLabel?: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const toggle = () => {
    if (pending) return;

    const next = !saved;
    setSaved(next);

    startTransition(async () => {
      const formData = new FormData();
      formData.set('bookId', bookId);

      const result = await toggleWishlistAction({ ok: false, error: '' }, formData);

      if (!result.ok) {
        setSaved(!next); // roll back
        toast.error('Could not update your wishlist', result.error);
        return;
      }

      router.refresh();

      if (next) {
        toast.success('Saved to your wishlist', bookTitle, {
          label: 'View wishlist',
          href: '/account/wishlist',
        });
      } else {
        toast.info('Removed from your wishlist', bookTitle);
      }
    });
  };

  const sizing =
    size === 'sm' ? 'h-9 w-9 min-h-9' : size === 'lg' ? 'h-12 w-12 min-h-12' : 'h-11 w-11 min-h-11';
  const icon = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-5.5 w-5.5' : 'h-5 w-5';

  if (withLabel) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${bookTitle} from your wishlist` : `Save ${bookTitle} to your wishlist`}
        className={cn(
          'inline-flex min-h-[44px] items-center gap-2.5 rounded-full border px-5 text-sm font-medium transition-colors',
          saved
            ? 'border-accent/40 bg-accent-soft text-accent'
            : 'border-line bg-paper text-ink hover:border-ink-faint hover:bg-paper-soft',
          className,
        )}
      >
        <HeartIcon className="h-4.5 w-4.5" filled={saved} />
        {saved ? 'Saved' : 'Save'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${bookTitle} from your wishlist` : `Save ${bookTitle} to your wishlist`}
      title={saved ? 'Remove from wishlist' : 'Save to wishlist'}
      className={cn(
        'flex items-center justify-center rounded-full border backdrop-blur-sm transition-all duration-200',
        sizing,
        saved
          ? 'border-accent/40 bg-paper/90 text-accent'
          : 'border-line/70 bg-paper/85 text-ink-soft hover:border-ink-faint hover:text-ink',
        pending && 'opacity-70',
        className,
      )}
    >
      <HeartIcon className={icon} filled={saved} />
    </button>
  );
}

function HeartIcon({ className, filled }: { className?: string; filled: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 20.5s-7.5-4.6-7.5-10a4.3 4.3 0 018-2.3 4.3 4.3 0 018 2.3c0 5.4-7.5 10-7.5 10z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
