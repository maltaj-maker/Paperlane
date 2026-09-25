'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Sort control + active-filter chips.
 *
 * The sort select submits the moment it changes (that is what people expect
 * from a sort control) but it is a real select inside a real form, so it still
 * works if the JavaScript has not loaded yet.
 */

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Most relevant' },
  { value: 'popularity', label: 'Bestselling' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'discount', label: 'Biggest discount' },
] as const;

export function CatalogueToolbar({
  total,
  showing,
  sort,
  didYouMean,
}: {
  total: number;
  showing: number;
  sort: string;
  didYouMean?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());

    if (value === null) params.delete(key);
    else params.set(key, value);

    // Any change to filters or sort resets to page 1 — landing on page 7 of a
    // new filter set is a guaranteed empty result.
    params.delete('page');

    startTransition(() => {
      router.push(`${pathname}${params.toString() ? `?${params}` : ''}`, { scroll: false });
    });
  }

  const activeChips = buildChips(searchParams);

  return (
    <div className="border-b border-line pb-4">
      {didYouMean && (
        <p className="mb-3 text-sm text-ink-muted">
          Did you mean{' '}
          <Link
            href={`${pathname}?${withParam(searchParams.toString(), 'q', didYouMean)}`}
            className="font-medium text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
          >
            {didYouMean}
          </Link>
          ?
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {total === 0 ? (
            'No matching books'
          ) : (
            <>
              <span className="font-medium text-ink tabular-nums">{total.toLocaleString('en-IN')}</span>{' '}
              {total === 1 ? 'book' : 'books'}
              {showing < total && <span className="text-ink-faint"> · showing {showing}</span>}
            </>
          )}
        </p>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-muted">Sort</span>
          <span className="relative">
            <select
              value={sort}
              onChange={(event) => updateParam('sort', event.target.value)}
              className={cn(
                'min-h-[44px] appearance-none rounded-full border border-line bg-paper py-2 pl-4 pr-9 text-sm font-medium text-ink',
                'transition-colors hover:border-ink-faint focus:border-ink focus:outline-none',
                pending && 'opacity-60',
              )}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <svg
              className="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path d="M4 6.5l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </label>
      </div>

      {activeChips.length > 0 && (
        <ul className="mt-3 flex flex-wrap items-center gap-2">
          {activeChips.map((chip) => (
            <li key={`${chip.key}-${chip.value}`}>
              <button
                type="button"
                onClick={() => updateParam(chip.key, chip.remaining.length > 0 ? chip.remaining.join(',') : null)}
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-paper-soft px-3 text-xs font-medium text-ink transition-colors hover:border-ink-faint hover:bg-paper"
                aria-label={`Remove filter: ${chip.label}`}
              >
                {chip.label}
                <svg className="h-3 w-3 text-ink-muted" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}

          <li>
            <Link
              href={pathname}
              className="inline-flex min-h-[32px] items-center px-2 text-xs font-medium text-ink-muted underline decoration-line underline-offset-4 hover:text-ink"
            >
              Clear all
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}

const CHIP_LABELS: Record<string, string> = {
  genre: 'Genre',
  format: 'Format',
  language: 'Language',
  publisher: 'Publisher',
  minPrice: 'Min ₹',
  maxPrice: 'Max ₹',
  rating: 'Rating',
  inStock: 'In stock',
  onSale: 'On offer',
  q: 'Search',
};

function buildChips(searchParams: URLSearchParams) {
  const chips: Array<{ key: string; value: string; label: string; remaining: string[] }> = [];

  // `sort`, `page` and `pageSize` are controls, not filters — they do not
  // belong in the "you have narrowed this" list.
  const skip = new Set(['sort', 'page', 'pageSize']);

  for (const key of new Set(Array.from(searchParams.keys()))) {
    if (skip.has(key)) continue;

    const values = searchParams.getAll(key);
    const prefix = CHIP_LABELS[key];

    for (const value of values) {
      chips.push({
        key,
        value,
        label: prefix ? `${prefix}: ${humanise(key, value)}` : humanise(key, value),
        remaining: values.filter((v) => v !== value),
      });
    }
  }

  return chips;
}

function humanise(key: string, value: string): string {
  if (key === 'inStock') return 'yes';
  if (key === 'onSale') return 'yes';
  if (key === 'rating') return `${value}★ & up`;
  if (key === 'minPrice') return `₹${value}`;
  if (key === 'maxPrice') return `₹${value}`;
  return value.replace(/_/g, ' ').replace(/-/g, ' ');
}

function withParam(query: string, key: string, value: string): string {
  const params = new URLSearchParams(query);
  params.set(key, value);
  params.delete('page');
  return params.toString();
}
