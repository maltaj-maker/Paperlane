/**
 * Navigation primitives: Breadcrumbs, Pagination, Tabs.
 *
 * All three are SEO-relevant, not just visual:
 *  - Breadcrumbs emit BreadcrumbList structured data and a real <nav> landmark.
 *  - Pagination uses crawlable <a href> links rather than JS handlers, so
 *    search engines can walk the catalogue.
 *  - Tabs render their labels as buttons with proper ARIA wiring and are
 *    deep-linkable via a `param` query key.
 */

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumbs with schema.org markup.
 * The final crumb is the current page and is not a link — linking to the page
 * you are already on is a small but real usability and SEO smell.
 */
export function Breadcrumbs({
  items,
  className,
  emitStructuredData = true,
}: {
  items: Crumb[];
  className?: string;
  emitStructuredData?: boolean;
}) {
  if (items.length === 0) return null;

  const structuredData = emitStructuredData
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.label,
          ...(item.href ? { item: item.href } : {}),
        })),
      }
    : null;

  return (
    <>
      <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                {index > 0 && (
                  <span aria-hidden="true" className="text-ink-faint">
                    /
                  </span>
                )}
                {isLast || !item.href ? (
                  <span aria-current={isLast ? 'page' : undefined} className="clamp-1 font-medium text-ink-soft">
                    {item.label}
                  </span>
                ) : (
                  <Link href={item.href} className="clamp-1 transition-colors hover:text-ink">
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {structuredData && (
        <script
          type="application/ld+json"
          // Structured data must be raw JSON in the document; escaping is handled
          // by JSON.stringify, and the payload is entirely server-controlled.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      )}
    </>
  );
}

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Builds the href for a page, preserving existing filters. */
  buildHref: (page: number) => string;
  className?: string;
  label?: string;
}

/** Windowed pagination: 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(page: number, totalPages: number): Array<number | 'gap'> {
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (page >= totalPages - 2) [totalPages - 1, totalPages - 2, totalPages - 3].forEach((p) => pages.add(p));

  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    const previous = sorted[i - 1];
    if (previous !== undefined && current - previous > 1) out.push('gap');
    out.push(current);
  }

  return out;
}

export function Pagination({ page, totalPages, buildHref, className, label = 'Pagination' }: PaginationProps) {
  if (totalPages <= 1) return null;

  const items = pageWindow(page, totalPages);

  return (
    <nav aria-label={label} className={cn('flex items-center justify-center', className)}>
      <ul className="flex flex-wrap items-center justify-center gap-1.5">
        <li>
          {page > 1 ? (
            <Link
              href={buildHref(page - 1)}
              rel="prev"
              className="flex h-10 min-w-10 items-center justify-center rounded-full border border-line px-3 text-sm font-medium transition-colors hover:border-ink-faint hover:bg-paper-soft"
            >
              <span className="sr-only">Previous page</span>
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="flex h-10 min-w-10 items-center justify-center rounded-full border border-line px-3 text-sm text-ink-faint opacity-50"
            >
              <span className="sr-only">Previous page (unavailable)</span>
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
        </li>

        {items.map((item, index) =>
          item === 'gap' ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-ink-faint">
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={buildHref(item)}
                aria-current={item === page ? 'page' : undefined}
                className={cn(
                  'flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm font-medium tabular-nums transition-colors',
                  item === page
                    ? 'bg-brand-700 text-paper'
                    : 'border border-line text-ink-soft hover:border-ink-faint hover:bg-paper-soft hover:text-ink',
                )}
              >
                {item}
              </Link>
            </li>
          ),
        )}

        <li>
          {page < totalPages ? (
            <Link
              href={buildHref(page + 1)}
              rel="next"
              className="flex h-10 min-w-10 items-center justify-center rounded-full border border-line px-3 text-sm font-medium transition-colors hover:border-ink-faint hover:bg-paper-soft"
            >
              <span className="sr-only">Next page</span>
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="flex h-10 min-w-10 items-center justify-center rounded-full border border-line px-3 text-sm text-ink-faint opacity-50"
            >
              <span className="sr-only">Next page (unavailable)</span>
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}

/** Numbered page results text, e.g. "Showing 25–48 of 312 books". */
export function ResultCount({ page, pageSize, total, noun = 'books', className }: { page: number; pageSize: number; total: number; noun?: string; className?: string }) {
  if (total === 0) {
    return (
      <p className={cn('text-sm text-ink-muted', className)}>No {noun} found</p>
    );
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <p className={cn('text-sm text-ink-muted tabular-nums', className)}>
      Showing <span className="font-medium text-ink-soft">{from}–{to}</span> of{' '}
      <span className="font-medium text-ink-soft">{total}</span> {noun}
    </p>
  );
}
