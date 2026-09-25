import Link from 'next/link';
import type { Metadata } from 'next';

import { Button } from '@/components/ui/Button';
import { SearchAutocomplete } from '@/components/search/SearchAutocomplete';

/**
 * 404.
 *
 * A dead end is a lost sale, so this page does three jobs: it says plainly that
 * the page is gone, it offers the most likely intended destinations, and it puts
 * a search box in front of the customer. Status 404 is set by Next automatically
 * for `notFound()`.
 *
 * No jokes about "losing the plot" — they read as filler to anyone but the
 * author, and a customer who mistyped a URL just wants the shelf.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-20 text-center sm:py-28">
      <p className="font-display text-5xl font-semibold tracking-tight text-ink-faint">404</p>

      <h1 className="mt-4 font-display text-2xl font-semibold text-ink sm:text-3xl">
        We could not find that page
      </h1>

      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
        The link may be old, or the book may have moved to a new page. Searching usually finds it —
        we will show the closest matches as you type.
      </p>

      <div className="mt-8 w-full max-w-md">
        <SearchAutocomplete variant="hero" autoFocus={false} />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-sm">
        <Link href="/books" className="font-medium text-ink underline-offset-4 hover:underline">
          All books
        </Link>
        <Link href="/genres" className="font-medium text-ink underline-offset-4 hover:underline">
          Browse genres
        </Link>
        <Link href="/collections" className="font-medium text-ink underline-offset-4 hover:underline">
          Collections
        </Link>
        <Link href="/contact" className="font-medium text-ink underline-offset-4 hover:underline">
          Contact us
        </Link>
      </div>

      <div className="mt-10">
        <Button href="/" variant="secondary">
          Back to the shop
        </Button>
      </div>
    </main>
  );
}
