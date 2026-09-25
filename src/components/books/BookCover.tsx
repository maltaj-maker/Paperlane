import Image from 'next/image';
import { cn } from '@/lib/cn';

/**
 * Book cover artwork.
 *
 * Uses `next/image` for automatic AVIF/WebP conversion, responsive `srcset` and
 * lazy loading — book covers are the dominant byte cost on every page, so this
 * is the single highest-leverage performance decision in the storefront.
 *
 * Two details that matter for a bookshop specifically:
 *  - Book covers are portrait 2:3. We reserve that aspect ratio always, which
 *    prevents the cumulative layout shift that plagues image-heavy grids.
 *  - A tasteful typographic fallback renders when there is no artwork, so a
 *    missing image looks like a design choice rather than a broken page.
 */

export interface BookCoverProps {
  src: string | null | undefined;
  alt: string;
  title?: string;
  author?: string;
  /** `sizes` hint — this is what the browser uses to pick a source. */
  sizes?: string;
  priority?: boolean;
  className?: string;
  /**
   * `card` adds the subtle spine shading; `plain` is used for hero/large art
   * where the artwork already carries the design.
   */
  variant?: 'card' | 'plain' | 'hero';
  /** Rounded corner radius. Books are rectangular; heavy rounding looks wrong. */
  rounded?: 'none' | 'sm' | 'md' | 'lg';
}

const ROUNDED = {
  none: '',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
};

export function BookCover({
  src,
  alt,
  title,
  author,
  sizes = '(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px',
  priority = false,
  className,
  variant = 'card',
  rounded = 'md',
}: BookCoverProps) {
  const radius = ROUNDED[rounded];

  return (
    <div
      className={cn(
        'relative aspect-[2/3] w-full overflow-hidden bg-paper-sunken',
        radius,
        variant === 'card' && 'book-spine shadow-book',
        variant === 'hero' && 'shadow-book-lg',
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          // Covers below the fold are lazy by default; the hero passes priority.
          loading={priority ? 'eager' : 'lazy'}
          className="cover-art object-cover"
        />
      ) : (
        <CoverFallback title={title} author={author} />
      )}
    </div>
  );
}

/**
 * Typographic stand-in for a missing cover.
 * Renders the title and author set like a jacket, which reads as intentional.
 */
function CoverFallback({ title, author }: { title?: string; author?: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-full w-full flex-col justify-between bg-gradient-to-br from-paper-soft to-paper-sunken p-3"
    >
      <div className="h-1 w-8 rounded-full bg-ink/15" />
      <div className="min-w-0">
        <p className="clamp-3 font-display text-sm font-semibold leading-tight text-ink-soft">
          {title ?? 'Cover coming soon'}
        </p>
        {author && <p className="mt-1 clamp-1 text-2xs uppercase tracking-wide text-ink-faint">{author}</p>}
      </div>
      <div className="h-1 w-5 rounded-full bg-ink/15" />
    </div>
  );
}

/**
 * Small square-ish cover for cart lines, order items and admin tables where the
 * full portrait artwork is too large.
 */
export function BookThumb({
  src,
  alt,
  title,
  author,
  size = 56,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  title?: string;
  author?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('relative shrink-0 overflow-hidden rounded bg-paper-sunken shadow-sm', className)}
      style={{ width: size, height: Math.round(size * 1.5) }}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={`${size}px`}
          loading="lazy"
          className="cover-art object-cover"
        />
      ) : (
        <CoverFallback title={title} author={author} />
      )}
    </div>
  );
}
