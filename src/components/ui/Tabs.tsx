'use client';

/**
 * Tabs — client-side switching with full ARIA wiring.
 *
 * Kept in its own module so the server-rendered navigation primitives
 * (Breadcrumbs, Pagination) do not drag a client boundary into every page that
 * uses them. Tab *content* is still server-rendered by the caller; only the
 * switching behaviour runs on the client.
 */

import * as React from 'react';
import { cn } from '@/lib/cn';

export interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
  badge?: string | number;
}

/**
 * Client-side tabs with proper ARIA wiring.
 *
 * Implemented as a client component because tab switching should not require a
 * round trip; the *content* inside each tab is still server-rendered, which is
 * what matters for SEO and first paint.
 */
export function Tabs({ tabs, defaultTab, className, idPrefix = 'tab' }: { tabs: Tab[]; defaultTab?: string; className?: string; idPrefix?: string }) {
  const [active, setActive] = React.useState(defaultTab ?? tabs[0]?.id ?? '');

  if (tabs.length === 0) return null;

  const activeIndex = Math.max(0, tabs.findIndex((t) => t.id === active));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();

    let next = activeIndex;
    if (event.key === 'ArrowLeft') next = (activeIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') next = (activeIndex + 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;

    setActive(tabs[next]!.id);
    document.getElementById(`${idPrefix}-${tabs[next]!.id}`)?.focus();
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Sections"
        className="scroll-x -mx-4 mb-6 flex gap-1 border-b border-line px-4 sm:mx-0 sm:px-0"
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`${idPrefix}-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={cn(
                'relative shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors',
                isActive ? 'text-ink' : 'text-ink-muted hover:text-ink-soft',
              )}
            >
              <span className="flex items-center gap-2">
                {tab.label}
                {tab.badge !== undefined && (
                  <span className="rounded-full bg-paper-sunken px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-ink-soft">
                    {tab.badge}
                  </span>
                )}
              </span>
              {isActive && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${idPrefix}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${idPrefix}-${tab.id}`}
          hidden={tab.id !== active}
          tabIndex={0}
          className="focus-visible:outline-none"
        >
          {tab.id === active ? tab.content : null}
        </div>
      ))}
    </div>
  );
}
