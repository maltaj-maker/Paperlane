'use client';

import { useState } from 'react';

import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

/**
 * Share controls, with Instagram given equal billing to the generic share.
 *
 * "Send this to a friend" is a real acquisition loop for a bookshop, and on
 * mobile the native sheet (`navigator.share`) is what people actually use — so
 * it becomes the first button when the API exists, and the explicit links are
 * the fallback for desktop browsers that lack it.
 *
 * The Instagram button deliberately copies the link rather than attempting a
 * deep link. Instagram has no public "share to story" URL for third parties;
 * pretending otherwise produces a broken button, which is worse than a copy.
 */
export function ShareButtons({
  url,
  title,
  instagramHandle,
  className,
}: {
  url: string;
  title: string;
  instagramHandle?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async (message: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(message, undefined, { label: 'Copied link', href: url });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is blocked in some in-app browsers; show the link so
      // it can still be copied by hand rather than failing silently.
      toast.info('Copy this link', url);
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title, url });
    } catch {
      /* user dismissed the sheet — not an error */
    }
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {canNativeShare && (
        <button
          type="button"
          onClick={nativeShare}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-ink transition-colors hover:bg-paper-soft"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 12v3.5A1.5 1.5 0 005.5 17h9a1.5 1.5 0 001.5-1.5V12"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Share
        </button>
      )}

      <button
        type="button"
        onClick={() => copy('Link copied')}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-ink transition-colors hover:bg-paper-soft"
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>

      <a
        href={`https://wa.me/?text=${encodeURIComponent(`${title} — ${url}`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-ink transition-colors hover:bg-paper-soft"
      >
        WhatsApp
      </a>

      <button
        type="button"
        onClick={() =>
          copy(
            instagramHandle
              ? `Link copied — paste it into your story and tag @${instagramHandle.replace(/^@/, '')}`
              : 'Link copied — paste it into your Instagram story',
          )
        }
        className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-ink transition-colors hover:bg-paper-soft"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="3.8" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="17" cy="7" r="1.2" fill="currentColor" />
        </svg>
        Story
      </button>
    </div>
  );
}
