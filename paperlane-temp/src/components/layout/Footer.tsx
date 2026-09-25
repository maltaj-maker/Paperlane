import Link from 'next/link';

import { env } from '@/lib/env';
import { getGenreTree } from '@/server/catalogue';
import { NewsletterForm } from '@/components/marketing/NewsletterForm';
import { InstagramCTA } from '@/components/marketing/InstagramCTA';
import { Wordmark } from './Wordmark';

/**
 * Site footer.
 *
 * Carries real navigational weight, not just legal links: genre links here are
 * a genuine internal-linking surface for search engines, and the trust signals
 * (returns window, secure payment, support hours) are the things a first-time
 * visitor looks for before entering card details.
 *
 * Payment-method marks are rendered as text/inline SVG rather than brand logos
 * to avoid shipping third-party trademark assets we have no licence to host.
 */
export async function Footer() {
  const e = env();
  const year = new Date().getFullYear();

  const genres = await getGenreTree().catch(() => []);
  const topGenres = genres.filter((g) => g.bookCount > 0).slice(0, 8);

  return (
    <footer className="mt-20 border-t border-line bg-paper-soft">
      {/* --- Instagram CTA: the primary growth channel --- */}
      <InstagramCTA />

      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          {/* Brand + newsletter */}
          <div className="lg:col-span-2">
            <Wordmark showTagline />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-muted">
              An independent bookshop for readers who like to be told honestly what a book is like.
              Every recommendation here is one we would make across the counter.
            </p>

            {e.FEATURE_NEWSLETTER && (
              <div className="mt-6 max-w-sm">
                <NewsletterForm source="footer" />
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <a
                href={e.SOCIAL_INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer me"
                aria-label={`Follow us on Instagram (@${e.SOCIAL_INSTAGRAM_HANDLE})`}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
              >
                <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="12" cy="12" r="3.8" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="17" cy="7" r="1.1" fill="currentColor" />
                </svg>
              </a>

              {e.SOCIAL_X_URL && (
                <a
                  href={e.SOCIAL_X_URL}
                  target="_blank"
                  rel="noopener noreferrer me"
                  aria-label="Follow us on X"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M17.6 3h3l-6.6 7.6L21.7 21h-6l-4.7-6.1L5.6 21h-3l7-8L2.6 3h6.2l4.3 5.6L17.6 3zm-1 16h1.7L7.5 4.7H5.7L16.6 19z" />
                  </svg>
                </a>
              )}

              {e.SOCIAL_FACEBOOK_URL && (
                <a
                  href={e.SOCIAL_FACEBOOK_URL}
                  target="_blank"
                  rel="noopener noreferrer me"
                  aria-label="Follow us on Facebook"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5h1.65V3.6A22 22 0 0014.3 3.5c-2.4 0-4 1.45-4 4.1v2.3H7.6V13h2.7v8h3.2z" />
                  </svg>
                </a>
              )}
            </div>
          </div>

          {/* Shop */}
          <nav aria-label="Shop">
            <h2 className="font-display text-sm font-semibold text-ink">Shop</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {[
                { href: '/books', label: 'All books' },
                { href: '/books?sort=newest', label: 'New releases' },
                { href: '/books?sort=popularity', label: 'Bestsellers' },
                { href: '/books?onSale=1', label: 'Offers & deals' },
                { href: '/collections', label: 'Collections' },
                { href: '/authors', label: 'Authors' },
                { href: '/publishers', label: 'Publishers' },
                { href: '/gift-cards', label: 'Gift cards' },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-ink-muted transition-colors hover:text-ink">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Genres (internal linking + SEO) */}
          <nav aria-label="Genres">
            <h2 className="font-display text-sm font-semibold text-ink">Browse by genre</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {topGenres.length > 0 ? (
                topGenres.map((genre) => (
                  <li key={genre.slug}>
                    <Link href={`/genres/${genre.slug}`} className="text-ink-muted transition-colors hover:text-ink">
                      {genre.name}
                    </Link>
                  </li>
                ))
              ) : (
                <li>
                  <Link href="/genres" className="text-ink-muted transition-colors hover:text-ink">
                    All genres
                  </Link>
                </li>
              )}
            </ul>
          </nav>

          {/* Help */}
          <nav aria-label="Help and information">
            <h2 className="font-display text-sm font-semibold text-ink">Help</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {[
                { href: '/track', label: 'Track your order' },
                { href: '/faq', label: 'FAQ' },
                { href: '/contact', label: 'Contact us' },
                { href: '/legal/shipping', label: 'Shipping policy' },
                { href: '/legal/returns', label: 'Returns & exchanges' },
                { href: '/legal/refunds', label: 'Refunds & cancellation' },
                { href: '/blog', label: 'Reading room' },
                { href: '/sitemap.xml', label: 'Sitemap' },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-ink-muted transition-colors hover:text-ink">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* --- Trust row --- */}
        <div className="mt-12 grid gap-4 border-t border-line pt-8 sm:grid-cols-2 lg:grid-cols-4">
          <TrustItem
            title="Secure payments"
            body="Payments are processed by our secure payment providers. Card details never touch our servers."
            icon={
              <path
                d="M12 3l7 3v6c0 4.4-3 8.2-7 9.4C8 20.2 5 16.4 5 12V6l7-3zM9.5 12l1.8 1.8 3.4-3.6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            }
          />
          <TrustItem
            title="7-day returns"
            body="Changed your mind? Send it back within 7 days of delivery."
            icon={
              <path
                d="M4 9a8 8 0 0113.7-3.4M20 15a8 8 0 01-13.7 3.4M4 4.5V9h4.5M20 19.5V15h-4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            }
          />
          <TrustItem
            title="Real people on support"
            body={`Email ${e.SUPPORT_EMAIL} — we reply within one working day.`}
            icon={
              <path
                d="M4 6.5h16v11H4v-11zM4 7l8 6 8-6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            }
          />
          <TrustItem
            title="Books, honestly reviewed"
            body="Reviews are moderated and marked when we have verified the purchase."
            icon={
              <path
                d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            }
          />
        </div>

        {/* --- Legal bar --- */}
        <div className="mt-10 flex flex-col gap-4 border-t border-line pt-8 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {e.APP_NAME}. All rights reserved.
          </p>

          <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {[
              { href: '/legal/terms', label: 'Terms of Service' },
              { href: '/legal/privacy', label: 'Privacy Policy' },
              { href: '/legal/cookies', label: 'Cookie Policy' },
              { href: '/legal/returns', label: 'Returns' },
              { href: '/legal/shipping', label: 'Shipping' },
              { href: '/legal/refunds', label: 'Refunds' },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="transition-colors hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <p className="mt-6 text-2xs leading-relaxed text-ink-faint">
          {e.APP_NAME} is an independent bookseller. Prices include GST where applicable and are shown in
          Indian Rupees. Payment methods: UPI, credit and debit cards, net banking and wallets (via PhonePe)
          {e.STORE_SUPPORT_COD ? ', and cash on delivery on eligible pin codes' : ''}. Availability and
          delivery estimates are confirmed at checkout.
        </p>
      </div>
    </footer>
  );
}

function TrustItem({ title, body, icon }: { title: string; body: string; icon: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <svg className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {icon}
      </svg>
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{body}</p>
      </div>
    </div>
  );
}
