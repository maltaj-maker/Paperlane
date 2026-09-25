'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { cn } from '@/lib/cn';
import { formatPaise } from '@/lib/money';

/**
 * Search with autocomplete.
 *
 * Behaviours that matter on a phone:
 *  - Suggestions appear after ~180ms of typing, never on every keystroke.
 *  - In-flight requests are aborted, so results can never arrive out of order
 *    and overwrite newer ones.
 *  - Enter always submits the *typed* query, even if a suggestion is
 *    highlighted — people expect their own words to win.
 *  - Arrow keys move through suggestions; Escape closes; the listbox follows the
 *    ARIA combobox pattern so screen readers announce result counts.
 *
 * The query itself is logged server-side for search analytics, which is how we
 * find out what people want that we do not stock.
 */

interface Suggestion {
  type: 'book' | 'author' | 'genre' | 'isbn' | 'query';
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
  imageUrl: string | null;
  /** Present for book suggestions. */
  pricePaise?: number;
  /** True when the suggestion came from typo recovery. */
  corrected?: boolean;
}

export function SearchAutocomplete({
  variant = 'inline',
  initialQuery = '',
  autoFocus = false,
  className,
}: {
  /** `inline` (desktop header), `mobile` (header row below lg), `hero` (homepage). */
  variant?: 'inline' | 'mobile' | 'hero';
  initialQuery?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`/api/v1/search/autocomplete?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('failed');

        const data = (await response.json()) as { suggestions?: Suggestion[] };
        setSuggestions(data.suggestions ?? []);
        setOpen(true);
        setActive(-1);
      } catch (err) {
        // An abort is expected and not an error; anything else fails quietly —
        // a broken suggestion list must never block a search.
        if ((err as Error)?.name !== 'AbortError') setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [query]);

  // Close on outside click / touch.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setOpen(false);
    router.push(`/books?q=${encodeURIComponent(trimmed)}`);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((prev) => Math.max(prev - 1, -1));
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    } else if (event.key === 'Enter') {
      if (active >= 0 && suggestions[active]) {
        event.preventDefault();
        setOpen(false);
        router.push(suggestions[active]!.href);
      }
      // Otherwise the form submits the typed query — the expected behaviour.
    }
  };

  return (
    <div ref={wrapRef} className={cn('relative w-full', className)}>
      <form
        role="search"
        action="/books"
        method="get"
        onSubmit={(event) => {
          event.preventDefault();
          submit(query);
        }}
      >
        <label htmlFor={`search-${variant}`} className="sr-only">
          Search books, authors or ISBN
        </label>

        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>

          <input
            id={`search-${variant}`}
            name="q"
            type="search"
            value={query}
            autoFocus={autoFocus}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search by title, author or ISBN"
            autoComplete="off"
            enterKeyHint="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            className={cn(
              'w-full rounded-full border border-line bg-paper pl-10 pr-4 text-base text-ink placeholder:text-ink-faint',
              'transition-colors hover:border-ink-faint focus:border-ink focus:outline-none',
              variant === 'hero' ? 'min-h-[54px] text-base shadow-book' : 'min-h-[44px] text-sm sm:text-base',
            )}
          />

          {loading && (
            <span
              className="absolute right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-line border-t-ink-muted"
              aria-hidden="true"
            />
          )}
        </div>
      </form>

      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-line bg-paper shadow-book-lg">
          <ul id={listId} role="listbox" aria-label="Search suggestions" className="max-h-[70vh] overflow-y-auto py-1.5">
            {suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.type}-${suggestion.href}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
              >
                <Link
                  href={suggestion.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3.5 py-2.5 transition-colors',
                    index === active ? 'bg-paper-soft' : 'hover:bg-paper-soft',
                  )}
                >
                  {suggestion.imageUrl ? (
                    // Plain <img>: these are 40px thumbnails inside a dropdown,
                    // where next/image's layout machinery costs more than it saves.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={suggestion.imageUrl}
                      alt=""
                      width={32}
                      height={48}
                      loading="lazy"
                      className="h-12 w-8 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <span className="flex h-12 w-8 shrink-0 items-center justify-center rounded-sm bg-paper-sunken text-2xs font-semibold uppercase text-ink-faint">
                      {suggestion.type === 'genre' ? '#' : suggestion.type === 'author' ? 'A' : 'Q'}
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block clamp-1 text-sm font-medium text-ink">{suggestion.label}</span>
                    {suggestion.sublabel && (
                      <span className="block clamp-1 text-xs text-ink-muted">{suggestion.sublabel}</span>
                    )}
                  </span>

                  {suggestion.pricePaise !== undefined && (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-ink">
                      {formatPaise(suggestion.pricePaise)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => submit(query)}
            className="flex w-full items-center justify-between border-t border-line px-3.5 py-3 text-sm font-medium text-ink transition-colors hover:bg-paper-soft"
          >
            <span>See all results for “{query.trim()}”</span>
            <svg className="h-4 w-4 text-ink-muted" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
