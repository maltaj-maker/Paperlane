'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/cn';
import { formatPaise } from '@/lib/money';

/**
 * Catalogue filters.
 *
 * Two decisions worth explaining:
 *
 *  1. It is a real `<form method="get">` pointing at the current path. That
 *     means filtering works with JavaScript disabled or still loading, the URL
 *     is always the source of truth (so results are shareable and crawlable),
 *     and the back button behaves the way people expect.
 *  2. On mobile it is a slide-over drawer; on desktop it is a sticky sidebar.
 *     Same markup, different presentation — no duplicated filter logic to keep
 *     in sync.
 *
 * Every checkbox maps to a repeated query parameter (`?genre=fiction&genre=crime`),
 * which the server reads with `toArray()`.
 */

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  children?: Array<{ name: string; slug: string; count?: number }>;
}

export function CatalogueFilters({
  genres,
  publishers,
  languages,
  formats,
  priceRanges,
  ratings,
  activeCount,
}: {
  genres: Array<{ id: string; name: string; slug: string; children: Array<{ name: string; slug: string }> }>;
  publishers: Array<{ name: string; slug: string }>;
  languages: FilterOption[];
  formats: FilterOption[];
  priceRanges: Array<{ key: string; label: string; minPaise: number; maxPaise: number | null; count: number }>;
  ratings: FilterOption[];
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes the drawer; body scroll is locked while it is open so the
  // page behind does not scroll on touch devices.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const has = (key: string, value: string) => searchParams.getAll(key).includes(value);

  const clearAll = () => {
    const params = new URLSearchParams();
    // Keep the search term — clearing filters should not restart the search.
    const q = searchParams.get('q');
    if (q) params.set('q', q);
    router.push(`${pathname}${params.toString() ? `?${params}` : ''}`);
    setOpen(false);
  };

  const panel = (
    <form
      action={pathname}
      method="get"
      className="space-y-6"
      // Server-side rendering of filter state from the URL is authoritative;
      // this form is the no-JS path and the drawer's contents.
    >
      {/* Preserve the search query when the form is submitted without JS */}
      {searchParams.get('q') && <input type="hidden" name="q" value={searchParams.get('q') ?? ''} />}

      <FilterGroup title="Availability">
        <Check name="inStock" value="1" label="In stock only" checked={has('inStock', '1')} />
        <Check name="onSale" value="1" label="On offer" checked={has('onSale', '1')} />
      </FilterGroup>

      {genres.length > 0 && (
        <FilterGroup title="Genre">
          {genres.map((genre) => (
            <div key={genre.id}>
              <Check name="genre" value={genre.slug} label={genre.name} checked={has('genre', genre.slug)} bold />
              {genre.children.length > 0 && (
                <div className="ml-6 mt-1.5 space-y-1.5 border-l border-line pl-3">
                  {genre.children.map((child) => (
                    <Check
                      key={child.slug}
                      name="genre"
                      value={child.slug}
                      label={child.name}
                      checked={has('genre', child.slug)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </FilterGroup>
      )}

      {priceRanges.length > 0 && (
        <FilterGroup title="Price">
          {priceRanges.map((range) => (
            <label key={range.key} className="flex cursor-pointer items-center gap-2.5 py-0.5 text-sm">
              <input
                type="radio"
                name="priceRange"
                value={range.key}
                defaultChecked={searchParams.get('priceRange') === range.key}
                className="h-4 w-4 shrink-0 border-line accent-[rgb(var(--accent))]"
                data-min={range.minPaise}
                data-max={range.maxPaise ?? ''}
                // Radios drive the two numeric inputs so the server keeps
                // receiving simple minPrice/maxPrice values.
                onChange={(event) => {
                  const input = event.currentTarget;
                  const form = input.form;
                  if (!form) return;
                  const min = form.elements.namedItem('minPrice') as HTMLInputElement | null;
                  const max = form.elements.namedItem('maxPrice') as HTMLInputElement | null;
                  if (min) min.value = String(Math.round(range.minPaise / 100));
                  if (max) max.value = range.maxPaise === null ? '' : String(Math.round(range.maxPaise / 100));
                }}
              />
              <span className="flex-1 text-ink-soft">{range.label}</span>
              <span className="text-2xs tabular-nums text-ink-faint">{range.count}</span>
            </label>
          ))}

          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              name="minPrice"
              inputMode="numeric"
              min={0}
              placeholder="Min ₹"
              defaultValue={searchParams.get('minPrice') ?? ''}
              aria-label="Minimum price in rupees"
              className="w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
            <span className="text-ink-faint">–</span>
            <input
              type="number"
              name="maxPrice"
              inputMode="numeric"
              min={0}
              placeholder="Max ₹"
              defaultValue={searchParams.get('maxPrice') ?? ''}
              aria-label="Maximum price in rupees"
              className="w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
          </div>

          <p className="mt-1.5 text-2xs text-ink-faint">
            Prices from {formatPaise(0)} upward — leave blank for any price.
          </p>
        </FilterGroup>
      )}

      {formats.length > 0 && (
        <FilterGroup title="Format">
          {formats.map((option) => (
            <Check
              key={option.value}
              name="format"
              value={option.value}
              label={option.label}
              count={option.count}
              checked={has('format', option.value)}
            />
          ))}
        </FilterGroup>
      )}

      {languages.length > 0 && (
        <FilterGroup title="Language">
          {languages.map((option) => (
            <Check
              key={option.value}
              name="language"
              value={option.value}
              label={option.label}
              count={option.count}
              checked={has('language', option.value)}
            />
          ))}
        </FilterGroup>
      )}

      {ratings.length > 0 && (
        <FilterGroup title="Customer rating">
          {ratings.map((option) => (
            <Check
              key={option.value}
              name="rating"
              value={option.value}
              label={option.label}
              count={option.count}
              checked={has('rating', option.value)}
            />
          ))}
        </FilterGroup>
      )}

      {publishers.length > 0 && (
        <FilterGroup title="Publisher">
          {publishers.slice(0, 15).map((publisher) => (
            <Check
              key={publisher.slug}
              name="publisher"
              value={publisher.slug}
              label={publisher.name}
              checked={has('publisher', publisher.slug)}
            />
          ))}
        </FilterGroup>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <button
          type="submit"
          className="min-h-[46px] rounded-full bg-brand-700 px-5 text-sm font-semibold text-paper transition-colors hover:bg-brand-600 lg:hidden"
        >
          Show results
        </button>

        <button
          type="button"
          onClick={clearAll}
          className="min-h-[44px] rounded-full border border-line px-5 text-sm font-medium text-ink transition-colors hover:bg-paper-soft"
        >
          Clear all{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
      </div>
    </form>
  );

  return (
    <>
      {/* Mobile trigger */}
      <div className="mb-4 flex items-center gap-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-ink"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4.5h12M4 8h8M6.5 11.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-2xs font-semibold text-white">
              {activeCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={clearAll}
          className={cn(
            'text-sm text-ink-muted underline decoration-line underline-offset-4 transition-opacity',
            activeCount === 0 && 'pointer-events-none opacity-0',
          )}
        >
          Clear
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-[80] lg:hidden" role="dialog" aria-modal="true" aria-label="Filter books">
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
          />

          <div className="absolute inset-y-0 right-0 flex w-[min(88vw,380px)] flex-col bg-paper shadow-book-lg">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-display text-lg font-semibold text-ink">Filters</h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-paper-soft hover:text-ink"
                aria-label="Close filters"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">{panel}</div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:block" aria-label="Filter books">
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">{panel}</div>
      </aside>
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2.5 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{title}</legend>
      <div className="space-y-1.5">{children}</div>
    </fieldset>
  );
}

function Check({
  name,
  value,
  label,
  count,
  checked,
  bold = false,
}: {
  name: string;
  value: string;
  label: string;
  count?: number;
  checked: boolean;
  bold?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-0.5 text-sm">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        className="h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--accent))]"
      />
      <span className={cn('flex-1', bold ? 'font-medium text-ink' : 'text-ink-soft')}>{label}</span>
      {count !== undefined && <span className="text-2xs tabular-nums text-ink-faint">{count}</span>}
    </label>
  );
}
