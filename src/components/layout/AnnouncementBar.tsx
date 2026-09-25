import Link from 'next/link';
import { getAnnouncement } from '@/server/content';

/**
 * Dismissible announcement strip.
 *
 * Content comes from the `announcement` banner placement, so a sale or a
 * delivery-notice can be published from the admin panel without a deploy.
 * Renders nothing when there is no active announcement — an empty coloured bar
 * is worse than no bar.
 */
export async function AnnouncementBar() {
  const announcement = await getAnnouncement().catch(() => null);
  if (!announcement) return null;

  const tone = announcement.theme === 'accent' ? 'bg-accent text-white' : 'bg-brand-700 text-paper';

  return (
    <div className={`print-hide ${tone}`}>
      <div className="mx-auto flex w-full max-w-7xl items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium sm:text-sm">
        {announcement.ctaHref ? (
          <Link href={announcement.ctaHref} className="group inline-flex items-center gap-1.5">
            <span>{announcement.title}</span>
            {announcement.ctaLabel && (
              <span className="underline decoration-current/40 underline-offset-2 group-hover:decoration-current">
                {announcement.ctaLabel}
              </span>
            )}
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        ) : (
          <p>{announcement.title}</p>
        )}
      </div>
    </div>
  );
}
