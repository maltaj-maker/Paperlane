'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/text';
import { logoutAction } from '@/app/actions/auth';

/**
 * Account menu.
 *
 * Signed out: a single "Sign in" affordance plus a sign-up link. Signed in: an
 * avatar that opens a menu with the destinations a customer actually needs.
 * Staff see an extra entry into the admin panel, but — importantly — that link
 * is cosmetic. The admin routes re-check the session server-side; hiding a link
 * is never the access control.
 */
export function AccountMenu({
  signedIn,
  name,
  email,
  isStaff,
}: {
  signedIn: boolean;
  name: string | null;
  email: string | null;
  isStaff: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await logoutAction();
      setOpen(false);
      router.push('/');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  if (!signedIn) {
    return (
      <Link
        href="/login"
        className="hidden h-11 items-center rounded-full px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink sm:flex"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name ?? 'your account'}`}
        className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-paper">
          {initials(name ?? email ?? 'U')}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-60 animate-scale-in overflow-hidden rounded-xl border border-line bg-paper shadow-book-lg"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="clamp-1 text-sm font-semibold text-ink">{name ?? 'Reader'}</p>
            <p className="clamp-1 text-xs text-ink-muted">{email}</p>
          </div>

          <div className="p-1.5">
            {[
              { href: '/account', label: 'Your account' },
              { href: '/account/orders', label: 'Orders & invoices' },
              { href: '/account/wishlist', label: 'Wishlist' },
              { href: '/account/reviews', label: 'Your reviews' },
              { href: '/account/support', label: 'Support requests' },
              { href: '/account/settings', label: 'Settings' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink"
              >
                {item.label}
              </Link>
            ))}

            {isStaff && (
              <>
                <div className="rule my-1.5" />
                <Link
                  href="/admin"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent-soft"
                >
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 1.8l4.8 2v4.4c0 2.7-1.8 4.9-4.8 6-3-1.1-4.8-3.3-4.8-6V3.8l4.8-2z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Admin panel
                </Link>
              </>
            )}
          </div>

          <div className="border-t border-line p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={onSignOut}
              disabled={signingOut}
              className={cn(
                'block w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                signingOut ? 'text-ink-faint' : 'text-danger hover:bg-danger/8',
              )}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
