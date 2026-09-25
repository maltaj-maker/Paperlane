import { env } from '@/lib/env';

/**
 * Instagram call to action.
 *
 * Instagram is the primary acquisition channel for this store, so the CTA is a
 * designed section rather than a footer icon. It does two jobs:
 *
 *  1. Gives someone who found the shop some other way a reason to follow.
 *  2. Explains, in one line, how deep links work — "tap the link in our bio" is
 *     the single most common way traffic will arrive, and saying it explicitly
 *     reduces bounces from people who are not sure they are in the right place.
 *
 * The link carries UTM parameters so arrivals from the bio link are attributed
 * correctly in the admin analytics rather than lumped in as "direct".
 */
export function InstagramCTA() {
  const e = env();

  const handle = e.SOCIAL_INSTAGRAM_HANDLE.replace(/^@/, '');
  // Tagged so the outbound click and any return visit are both attributable.
  const taggedUrl = `${e.SOCIAL_INSTAGRAM_URL.replace(/\/$/, '')}/${handle}/?utm_source=${encodeURIComponent(e.APP_URL)}&utm_medium=social&utm_campaign=site_footer`;

  return (
    <section aria-labelledby="instagram-cta-heading" className="border-b border-line bg-brand-700 text-paper">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-paper/70">
            Follow the shop
          </p>

          <h2 id="instagram-cta-heading" className="mt-2 font-display text-2xl font-semibold leading-snug sm:text-3xl">
            We post one book a day on Instagram
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-paper/80">
            New arrivals, what we are reading, and honest one-paragraph verdicts. Tap through from a Reel
            or Story and you will land straight on that book&rsquo;s page — link in bio, always up to date.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3">
          <a
            href={taggedUrl}
            target="_blank"
            rel="noopener noreferrer me"
            className="inline-flex items-center gap-2.5 rounded-full bg-paper px-6 py-3.5 text-sm font-semibold text-ink transition-transform hover:scale-[1.02] active:scale-[0.99]"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="12" cy="12" r="3.8" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="17" cy="7" r="1.2" fill="currentColor" />
            </svg>
            Follow @{handle}
          </a>

          <p className="text-2xs text-paper/60">
            {e.SOCIAL_INSTAGRAM_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')}/{handle}
          </p>
        </div>
      </div>
    </section>
  );
}
