'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { updateCartItemAction, removeCartItemAction } from '@/app/actions/cart';
import { IDLE } from '@/app/actions/types';
import { Price } from '@/components/ui/Price';
import { StockBadge } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

export interface CartLineView {
  id: string;
  quantity: number;
  book: {
    id: string;
    title: string;
    slug: string;
    coverImageUrl: string;
    coverAlt: string | null;
    pricePaise: number;
    salePricePaise: number | null;
    format: string;
    authorName: string;
  };
  available: number;
  status: string;
  priceChanged: boolean;
  currentUnitPricePaise: number;
  maxQuantity: number;
}

/**
 * One basket line.
 *
 * Quantity changes are optimistic — the number moves instantly, then reconciles.
 * If the server refuses (stock dropped, cap reached) we roll back *and say why*,
 * because a quantity that silently snaps back to its old value reads as a bug.
 *
 * Removing asks for confirmation only when the line is being removed from a
 * menu rather than by setting the quantity to zero, so the common path stays
 * one tap.
 */
export function CartLineItem({
  line,
  onUpdated,
}: {
  line: CartLineView;
  onUpdated?: () => void;
}) {
  const [quantity, setQuantity] = useState(line.quantity);
  const [removing, setRemoving] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const max = Math.max(1, Math.min(line.maxQuantity || 10, line.available || 10));
  const outOfStock = line.status === 'out_of_stock' || line.available <= 0;

  const commit = (nextQuantity: number) => {
    if (nextQuantity === quantity) return;
    const previous = quantity;
    setQuantity(nextQuantity);

    startTransition(async () => {
      const formData = new FormData();
      formData.set('cartItemId', line.id);
      formData.set('quantity', String(nextQuantity));

      const result = await updateCartItemAction(IDLE, formData);

      if (!result.ok) {
        setQuantity(previous); // roll back
        toast.error('Could not update the quantity', result.error);
        return;
      }

      router.refresh();
      onUpdated?.();
    });
  };

  const remove = () => {
    if (removing) return;
    setRemoving(true);

    startTransition(async () => {
      const result = await removeCartItemAction(line.id);

      if (!result.ok) {
        setRemoving(false);
        toast.error('Could not remove that', result.error);
        return;
      }

      toast.info('Removed from your basket', line.book.title);
      router.refresh();
      onUpdated?.();
    });
  };

  return (
    <li
      className={cn(
        'flex gap-4 py-5 transition-opacity',
        (pending || removing) && 'opacity-60',
        outOfStock && 'opacity-70',
      )}
    >
      <Link href={`/books/${line.book.slug}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
        <div className="relative h-[122px] w-[82px] overflow-hidden rounded-md bg-paper-sunken shadow-book">
          {line.book.coverImageUrl ? (
            <Image
              src={line.book.coverImageUrl}
              alt=""
              fill
              sizes="82px"
              className="cover-art object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-2">
              <span className="clamp-3 text-center text-2xs font-medium text-ink-soft">{line.book.title}</span>
            </div>
          )}
        </div>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="clamp-2 font-display text-[15px] font-semibold leading-snug">
              <Link href={`/books/${line.book.slug}`} className="text-ink transition-colors hover:text-accent">
                {line.book.title}
              </Link>
            </h3>
            <p className="mt-0.5 text-xs text-ink-muted">{line.book.authorName}</p>
            <p className="mt-0.5 text-2xs uppercase tracking-wide text-ink-faint">
              {line.book.format.replace(/_/g, ' ')}
            </p>
          </div>

          <button
            type="button"
            onClick={remove}
            disabled={pending || removing}
            aria-label={`Remove ${line.book.title} from your basket`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-paper-soft hover:text-danger disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mt-2">
          {outOfStock ? (
            <StockBadge status="out_of_stock" />
          ) : line.available <= 5 ? (
            <StockBadge status="low_stock" available={line.available} showCount />
          ) : null}
        </div>

        {line.priceChanged && (
          <p className="mt-2 text-xs text-warning">
            The price changed since you added this — your basket has the current price.
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
          {/* Quantity control: native number input, so it works with a keyboard,
              a numeric keypad, and screen readers without any custom ARIA. */}
          <div className="flex items-center gap-1 rounded-full border border-line p-0.5">
            <button
              type="button"
              onClick={() => commit(quantity - 1)}
              disabled={pending || quantity <= 1}
              aria-label={quantity <= 1 ? 'Remove item' : 'Decrease quantity'}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink transition-colors hover:bg-paper-soft disabled:opacity-40"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            </button>

            <label className="sr-only" htmlFor={`qty-${line.id}`}>
              Quantity of {line.book.title}
            </label>
            <input
              id={`qty-${line.id}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={max}
              value={quantity}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isNaN(next)) return;
                setQuantity(Math.max(1, Math.min(max, next)));
              }}
              onBlur={(event) => commit(Number(event.target.value) || 1)}
              className="h-9 w-11 border-0 bg-transparent text-center text-sm font-medium tabular-nums text-ink focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />

            <button
              type="button"
              onClick={() => commit(quantity + 1)}
              disabled={pending || quantity >= max}
              aria-label={quantity >= max ? `Maximum ${max} per order` : 'Increase quantity'}
              title={quantity >= max ? `Maximum ${max} per order` : undefined}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink transition-colors hover:bg-paper-soft disabled:opacity-40"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="text-right">
            <Price
              pricePaise={line.currentUnitPricePaise * quantity}
              size="md"
              className="justify-end"
            />
            {quantity > 1 && (
              <p className="mt-0.5 text-2xs tabular-nums text-ink-faint">
                {line.currentUnitPricePaise === 0
                  ? ''
                  : `${quantity} × ₹${(line.currentUnitPricePaise / 100).toFixed(2)}`}
              </p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
