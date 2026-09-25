'use client';

import { useState } from 'react';
import Image from 'next/image';

import { cn } from '@/lib/cn';

/**
 * Cover gallery with zoom.
 *
 * Zoom implementation notes: clicking (or tapping) the main image opens a
 * full-screen lightbox at natural resolution rather than an in-place CSS zoom.
 * On a phone, a pinch-zoom inside a page fights the browser's own gestures; a
 * dedicated overlay with its own scroll/scale is the only version that feels
 * right on iOS Safari and Chrome Android alike.
 *
 * Keyboard: arrow keys move between images, Escape closes. The lightbox traps
 * Tab focus so a screen-reader user cannot wander into the page behind it.
 */
export function BookGallery({
  images,
  title,
  className,
}: {
  images: Array<{ url: string; alt: string | null }>;
  title: string;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  // Always render at least one frame; a book page with no image looks broken.
  // `noUncheckedIndexedAccess` is on, so the fallback is declared explicitly
  // rather than smuggled in with a non-null assertion.
  const frames: Array<{ url: string; alt: string | null }> =
    images.length > 0 ? images : [{ url: '', alt: null }];
  const current: { url: string; alt: string | null } =
    frames[Math.min(active, frames.length - 1)] ?? { url: '', alt: null };

  const go = (delta: number) => {
    setActive((prev) => (prev + delta + frames.length) % frames.length);
  };

  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row-reverse sm:gap-5', className)}>
      {/* Main image */}
      <div className="flex-1">
        <button
          type="button"
          onClick={() => current.url && setLightbox(true)}
          disabled={!current.url}
          aria-label={current.url ? `Enlarge cover of ${title}` : undefined}
          className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg bg-paper-sunken shadow-book focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <div className="relative aspect-[2/3] w-full">
            {current.url ? (
              <Image
                src={current.url}
                alt={current.alt ?? `Cover of ${title}`}
                fill
                sizes="(max-width: 640px) 90vw, 420px"
                priority
                className="cover-art object-contain"
              />
            ) : (
              <div className="flex h-full flex-col justify-between bg-gradient-to-br from-paper-soft to-paper-sunken p-6">
                <span className="h-1 w-12 rounded-full bg-ink/15" />
                <span className="font-display text-lg font-semibold text-ink-soft">{title}</span>
                <span className="h-1 w-8 rounded-full bg-ink/15" />
              </div>
            )}
          </div>

          {current.url && (
            <span className="pointer-events-none absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-paper/90 text-ink-soft opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M7 2.5H2.5V7M9 13.5h4.5V9M13.5 2.5L9.2 6.8M2.5 13.5l4.3-4.3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}
        </button>
      </div>

      {/* Thumbnails */}
      {frames.length > 1 && (
        <ul className="flex gap-3 sm:w-20 sm:flex-col" role="tablist" aria-label="Cover images">
          {frames.map((frame, index) => (
            <li key={`${frame.url}-${index}`} className="sm:w-full">
              <button
                type="button"
                role="tab"
                aria-selected={index === active}
                onClick={() => setActive(index)}
                className={cn(
                  'relative block w-14 overflow-hidden rounded border transition-colors sm:w-full',
                  index === active ? 'border-ink' : 'border-line hover:border-ink-faint',
                )}
              >
                <span className="relative block aspect-[2/3] w-full bg-paper-sunken">
                  {frame.url && (
                    <Image
                      src={frame.url}
                      alt=""
                      fill
                      sizes="80px"
                      loading="lazy"
                      className="object-cover"
                    />
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Lightbox */}
      {lightbox && current.url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} — enlarged cover`}
          className="fixed inset-0 z-[95] flex flex-col bg-ink/95 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setLightbox(false);
            if (event.key === 'ArrowRight') go(1);
            if (event.key === 'ArrowLeft') go(-1);
          }}
          tabIndex={-1}
          ref={(node) => node?.focus()}
        >
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setLightbox(false)}
              className="flex h-11 w-11 items-center justify-center rounded-full text-paper/80 transition-colors hover:bg-paper/10 hover:text-paper"
              aria-label="Close enlarged cover"
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="relative flex flex-1 items-center justify-center overflow-auto">
            <div className="relative h-full w-full max-w-3xl">
              <Image
                src={current.url}
                alt={current.alt ?? `Cover of ${title}`}
                fill
                sizes="90vw"
                className="object-contain"
                priority
              />
            </div>
          </div>

          {frames.length > 1 && (
            <div className="mt-3 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => go(-1)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-paper/10 text-paper"
                aria-label="Previous image"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              <span className="text-sm tabular-nums text-paper/70">
                {active + 1} / {frames.length}
              </span>

              <button
                type="button"
                onClick={() => go(1)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-paper/10 text-paper"
                aria-label="Next image"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M8 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
