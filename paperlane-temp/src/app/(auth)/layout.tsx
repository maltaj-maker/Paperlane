import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

/**
 * Shell for the account-entry pages (sign in, sign up, password reset).
 *
 * These pages are the ones a customer reaches from an Instagram bio link on a
 * phone, so the layout is a single column, comfortably thumb-reachable, and free
 * of the header's competing links. The only way out is the logo and the footer
 * line, which is intentional: a sign-in page with six exits is a sign-in page
 * people abandon.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col bg-paper-soft">
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-[420px]">
          <div className="mb-6 text-center">
            <Link
              href="/"
              className="font-display text-xl font-semibold tracking-tight text-ink"
              aria-label="Paper Lantern Books — home"
            >
              Paper Lantern
            </Link>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-ink-faint">
              Books &amp; reading room
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-paper p-5 shadow-sm sm:p-7">{children}</div>
        </div>
      </main>
    </div>
  );
}
