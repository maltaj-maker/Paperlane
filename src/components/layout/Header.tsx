import Link from 'next/link';
import { Suspense } from 'react';

import { getCurrentUser } from '@/server/auth';
import { getCartCount } from '@/server/cart';
import { getGenreTree } from '@/server/catalogue';
import { isFeatureEnabled } from '@/server/content';
import { db } from '@/server/db';
import { permissionsForRole } from '@/lib/permissions';
import { env, publicEnv } from '@/lib/env';
import { formatPaise } from '@/lib/money';
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete';
import { ThemeToggle } from './ThemeToggle';
import { MobileMenu } from './MobileMenu';
import { AccountMenu } from './AccountMenu';
import { CartIndicator } from './CartIndicator';
import { Wordmark } from './Wordmark';
import { env } from '@/lib/env';
import { CategoryNav } from './CategoryNav';

/**
 * Site header.
 *
 * Server component: the cart count, signed-in state and genre tree are all
 * fetched on the server so the header renders complete on first paint — no
 * "0" badge that flickers to "3" a moment later.
 *
 * Layout: one row on mobile (menu · wordmark · cart), two rows from `md` up
 * (utility row + search row), and a category bar underneath. That matches how
 * people actually use a bookshop on a phone: search first, browse second.
 */
export async function Header() {
  const [user, cartCount, genres, wishlistFeature] = await Promise.all([
    getCurrentUser().catch(() => null),
    getCartCount().catch(() => 0),
    getGenreTree().catch(() => []),
    isFeatureEnabled('wishlist').catch(() => true),
  ]);

  const wishlistCount = user
    ? await db.wishlistItem.count({ where: { userId: user.id } }).catch(() => 0)
    : 0;

  const isStaff = user ? permissionsForRole(user.role).length > 0 : false;

  // Promises made in the header must be true. The threshold comes from config,
  // and the line disappears entirely when free delivery is switched off.
  const thresholdPaise = publicEnv().STORE_FREE_SHIPPING_THRESHOLD_PAISE;
  const freeShippingLabel = thresholdPaise
    ? `Free delivery over ${formatPaise(thresholdPaise)}`
    : 'Free delivery on every order';

  // Only top-level genres with books appear in navigation; an empty category is
  // a dead end for both customers and crawlers.
  const navGenres = genres
    .filter((genre) => genre.bookCount > 0)
    .slice(0, 9)
    .map((genre) => ({
      id: genre.id,
      name: genre.name,
      slug: genre.slug,
      children: genre.children.filter((c) => c.bookCount > 0).map((c) => ({ name: c.name, slug: c.slug })),
    }));

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/90 backdrop-blur-md supports-[backdrop-filter]:bg-paper/75">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        {/* --- Utility row (desktop only) --- */}
        <div className="hidden items-center justify-between gap-6 py-2 text-xs text-ink-muted md:flex">
          <p className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 text-success" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 8.5l3.5 3.5L14 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {freeShippingLabel} · Dispatched within 24 hours
          </p>

          <nav aria-label="Secondary" className="flex items-center gap-5">
            <Link href="/track" className="transition-colors hover:text-ink">
              Track order
            </Link>
            <Link href="/contact" className="transition-colors hover:text-ink">
              Help
            </Link>
            <Link href="/blog" className="transition-colors hover:text-ink">
              Reading room
            </Link>
          </nav>
        </div>

        {/* --- Main row --- */}
        <div className="flex items-center gap-3 py-3 md:gap-6">
          {/* Mobile menu trigger */}
          <div className="md:hidden">
            <MobileMenu genres={navGenres} isSignedIn={Boolean(user)} />
          </div>

          <Link href="/" className="shrink-0 rounded-lg" aria-label={`${env().APP_NAME} — home`}>
            <Wordmark />
          </Link>

          {/* Search: full width on mobile below, inline from lg up */}
          <div className="ml-auto hidden min-w-0 flex-1 lg:block lg:max-w-xl">
            <Suspense fallback={<div className="h-11 rounded-full border border-line bg-paper-soft" aria-hidden="true" />}>
              <SearchAutocomplete variant="inline" />
            </Suspense>
          </div>

          <div className="ml-auto flex items-center gap-0.5 lg:ml-0">
            {wishlistFeature && (
              <Link
                href="/account/wishlist"
                aria-label={`Wishlist${wishlistCount > 0 ? `, ${wishlistCount} saved` : ''}`}
                title="Wishlist"
                className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 20.5s-7.5-4.6-7.5-10a4.3 4.3 0 018-2.3 4.3 4.3 0 018 2.3c0 5.4-7.5 10-7.5 10z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
                {wishlistCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-semibold text-paper">
                    {wishlistCount > 9 ? '9+' : wishlistCount}
                  </span>
                )}
              </Link>
            )}

            <AccountMenu
              signedIn={Boolean(user)}
              name={user?.name ?? null}
              email={user?.email ?? null}
              isStaff={isStaff}
            />

            <CartIndicator count={cartCount} />

            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
          </div>
        </div>

        {/* --- Mobile search row --- */}
        <div className="pb-3 lg:hidden">
          <Suspense fallback={<div className="h-11 rounded-full border border-line bg-paper-soft" aria-hidden="true" />}>
            <SearchAutocomplete variant="mobile" />
          </Suspense>
        </div>
      </div>

      {/* --- Category bar --- */}
      {navGenres.length > 0 && (
        <CategoryNav genres={navGenres} />
      )}
    </header>
  );
}
