'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './ThemeToggle';

interface NavGenre {
  id: string;
  name: string;
  slug: string;
  children: Array<{ name: string; slug: string }>;
}

/**
 * Mobile navigation drawer.
 *
 * On a phone this is the primary way to browse, so it gets real attention:
 *  - Full-height panel with the genre tree, expandable in place.
 *  - Closes on navigation (otherwise the menu stays open over the new page).
 *  - Escape closes, body scroll locks, focus moves into the panel and returns
 *    to the trigger on close.
 */
export function MobileMenu({ genres, isSignedIn }: { genres: NavGenre[]; isSignedIn: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const pathname = usePathname();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // Close on route change.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape + scroll lock while open.
  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';

    // Move focus into the panel so keyboard users are not left behind.
    const firstLink = panelRef.current?.querySelector<HTMLElement>('a, button');
    firstLink?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-menu"
        className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[70] bg-ink/50 backdrop-blur-[2px] transition-opacity duration-200 md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        // `inert`-like behaviour: hidden from AT and untabbable when closed.
        {...(!open ? { inert: '' as unknown as boolean } : {})}
        className={cn(
          'fixed inset-y-0 left-0 z-[71] flex w-[86%] max-w-sm flex-col bg-paper shadow-book-lg transition-transform duration-300 ease-out-soft md:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <span className="font-display text-base font-semibold">Menu</span>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
            }}
            aria-label="Close menu"
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-paper-soft hover:text-ink"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <ul className="space-y-0.5">
            <li>
              <Link
                href="/books"
                className="flex items-center justify-between rounded-xl px-3 py-3 text-[15px] font-medium text-ink transition-colors hover:bg-paper-soft"
              >
                All books
                <Arrow />
              </Link>
            </li>

            <li>
              <Link
                href="/books?sort=newest"
                className="flex items-center justify-between rounded-xl px-3 py-3 text-[15px] font-medium text-ink transition-colors hover:bg-paper-soft"
              >
                New releases
                <Arrow />
              </Link>
            </li>

            <li>
              <Link
                href="/books?sort=popularity"
                className="flex items-center justify-between rounded-xl px-3 py-3 text-[15px] font-medium text-ink transition-colors hover:bg-paper-soft"
              >
                Bestsellers
                <Arrow />
              </Link>
            </li>

            <li className="pt-2">
              <p className="px-3 pb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Browse genres
              </p>
            </li>

            {genres.map((genre) => {
              const isExpanded = expanded === genre.id;
              const hasChildren = genre.children.length > 0;

              return (
                <li key={genre.id}>
                  <div className="flex items-center">
                    <Link
                      href={`/genres/${genre.slug}`}
                      className="min-w-0 flex-1 rounded-xl px-3 py-3 text-[15px] text-ink transition-colors hover:bg-paper-soft"
                    >
                      <span className="clamp-1">{genre.name}</span>
                    </Link>

                    {hasChildren && (
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : genre.id)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Hide' : 'Show'} subgenres of ${genre.name}`}
                        className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-paper-soft hover:text-ink"
                      >
                        <svg
                          className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')}
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {hasChildren && isExpanded && (
                    <ul className="mb-1 ml-3 space-y-0.5 border-l border-line pl-3">
                      {genre.children.map((child) => (
                        <li key={child.slug}>
                          <Link
                            href={`/genres/${child.slug}`}
                            className="block rounded-lg px-3 py-2.5 text-sm text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink"
                          >
                            {child.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}

            <li className="pt-3">
              <div className="rule mx-3" />
            </li>

            {[
              { href: '/collections', label: 'Collections' },
              { href: '/authors', label: 'Authors' },
              { href: '/blog', label: 'Reading room' },
              { href: '/track', label: 'Track your order' },
              { href: '/faq', label: 'Help & FAQ' },
              { href: '/contact', label: 'Contact us' },
            ].map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-xl px-3 py-3 text-[15px] text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-line px-5 py-4 pb-safe">
          <div className="flex items-center justify-between gap-3">
            <Link
              href={isSignedIn ? '/account' : '/login'}
              className="flex-1 rounded-full bg-brand-700 px-4 py-3 text-center text-sm font-semibold text-paper transition-colors hover:bg-brand-600"
            >
              {isSignedIn ? 'Your account' : 'Sign in'}
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </>
  );
}

function Arrow() {
  return (
    <svg className="h-4 w-4 shrink-0 text-ink-faint" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
