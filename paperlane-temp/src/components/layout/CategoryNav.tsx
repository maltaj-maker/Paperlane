'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

interface NavGenre {
  id: string;
  name: string;
  slug: string;
  children: Array<{ name: string; slug: string }>;
}

/**
 * Category bar beneath the header.
 *
 * Horizontally scrollable on mobile (the standard pattern for this kind of nav),
 * and a hover-open mega-menu from `lg` up. The mega-menu is keyboard accessible:
 * opening on focus and closing on Escape means it is usable without a mouse,
 * which hover-only menus almost never are.
 */
export function CategoryNav({ genres }: { genres: NavGenre[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const pathname = usePathname();
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setOpenId(null);
  }, [pathname]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const open = (id: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenId(id);
  };

  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // Small delay so moving the pointer diagonally into the panel does not
    // close it — a classic mega-menu annoyance.
    closeTimer.current = setTimeout(() => setOpenId(null), 160);
  };

  const active = openId ? genres.find((g) => g.id === openId) : null;

  return (
    <nav
      aria-label="Browse genres"
      className="relative border-t border-line bg-paper"
      onMouseLeave={scheduleClose}
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <ul className="scroll-x flex items-center gap-0.5 py-0.5">
          <li className="shrink-0">
            <Link
              href="/books"
              className={cn(
                'flex items-center whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors',
                pathname === '/books' ? 'text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              All books
            </Link>
          </li>

          {genres.map((genre) => {
            const isActive = pathname === `/genres/${genre.slug}`;
            const hasChildren = genre.children.length > 0;

            return (
              <li
                key={genre.id}
                className="shrink-0"
                onMouseEnter={() => (hasChildren ? open(genre.id) : setOpenId(null))}
              >
                <Link
                  href={`/genres/${genre.slug}`}
                  aria-expanded={hasChildren ? openId === genre.id : undefined}
                  aria-haspopup={hasChildren ? 'true' : undefined}
                  onFocus={() => (hasChildren ? open(genre.id) : undefined)}
                  className={cn(
                    'flex items-center gap-1 whitespace-nowrap px-3 py-2.5 text-sm transition-colors',
                    isActive || openId === genre.id ? 'font-medium text-ink' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {genre.name}
                  {hasChildren && (
                    <svg className="h-3 w-3 opacity-60" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </Link>
              </li>
            );
          })}

          <li className="shrink-0">
            <Link
              href="/collections"
              className="flex items-center whitespace-nowrap px-3 py-2.5 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Collections
            </Link>
          </li>

          <li className="shrink-0">
            <Link
              href="/books?onSale=1"
              className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm text-accent transition-colors hover:brightness-110"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Offers
            </Link>
          </li>
        </ul>
      </div>

      {/* Mega-menu panel */}
      {active && active.children.length > 0 && (
        <div
          className="absolute inset-x-0 top-full z-40 hidden animate-fade-in border-b border-line bg-paper shadow-book lg:block"
          onMouseEnter={() => open(active.id)}
        >
          <div className="mx-auto w-full max-w-7xl px-6 py-6">
            <div className="grid gap-8 md:grid-cols-[1fr_2fr]">
              <div>
                <h3 className="font-display text-lg font-semibold text-ink">{active.name}</h3>
                <Link
                  href={`/genres/${active.slug}`}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:brightness-110"
                >
                  Browse all {active.name.toLowerCase()}
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>

              <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 xl:grid-cols-3">
                {active.children.map((child) => (
                  <li key={child.slug}>
                    <Link
                      href={`/genres/${child.slug}`}
                      className="block rounded-lg px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink"
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
