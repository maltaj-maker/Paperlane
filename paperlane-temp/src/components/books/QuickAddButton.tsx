'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { quickAddAction } from '@/app/actions/cart';
import { useToast } from '@/components/ui/Toast';
import { Spinner } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { trackClientEvent } from '@/components/analytics/AnalyticsScripts';

/**
 * Quick-add button for catalogue cards.
 *
 * Optimistic feedback matters more here than anywhere else in the app: this is
 * the button tapped most often, and on a slow mobile connection a 900ms wait
 * with no acknowledgement reads as "broken" and gets tapped three more times.
 * So we show an immediate check state, then reconcile with the server, and roll
 * back with an explanation if the server disagrees (out of stock, price moved).
 */
export function QuickAddButton({
  bookId,
  bookTitle,
  expectedUnitPricePaise,
  disabled = false,
  label = 'Add to basket',
  className,
  size = 'sm',
}: {
  bookId: string;
  bookTitle: string;
  expectedUnitPricePaise?: number;
  disabled?: boolean;
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const [pending, startTransition] = useTransition();
  const [justAdded, setJustAdded] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const onClick = () => {
    if (disabled || pending) return;

    // Optimistic: flip the button immediately.
    setJustAdded(true);

    startTransition(async () => {
      const result = await quickAddAction(bookId, 1);

      if (result.ok) {
        trackClientEvent('add_to_cart', {
          bookId,
          quantity: 1,
          valuePaise: expectedUnitPricePaise,
        });

        toast.success('Added to your basket', bookTitle, { label: 'View basket', href: '/cart' });

        // Refresh so header counts and any server-rendered totals update.
        router.refresh();

        setTimeout(() => setJustAdded(false), 2_000);
        return;
      }

      // Server said no. Say why, in plain language.
      setJustAdded(false);

      toast.error(
        result.code === 'OUT_OF_STOCK' ? 'Just sold out' : 'Could not add that',
        result.error,
      );
    });
  };

  const succeeded = justAdded && !pending;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      aria-label={
        disabled
          ? `${bookTitle} is out of stock`
          : succeeded
            ? `${bookTitle} added to basket`
            : `${label}: ${bookTitle}`
      }
      className={cn(
        'inline-flex w-full items-center justify-center gap-2 rounded-full border font-medium transition-all duration-200',
        size === 'sm' ? 'min-h-[38px] px-3.5 text-xs' : 'min-h-[44px] px-5 text-sm',
        succeeded
          ? 'border-success/40 bg-success/10 text-success'
          : disabled
            ? 'cursor-not-allowed border-line bg-paper-sunken text-ink-faint'
            : 'border-line bg-paper text-ink hover:border-ink hover:bg-ink hover:text-paper',
        className,
      )}
    >
      {pending ? (
        <>
          <Spinner label="Adding" />
          <span>Adding</span>
        </>
      ) : succeeded ? (
        <>
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Added</span>
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
          <span>{disabled ? 'Out of stock' : label}</span>
        </>
      )}
    </button>
  );
}
