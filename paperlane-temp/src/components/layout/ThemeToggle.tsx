'use client';

import { useEffect, useState } from 'react';

/**
 * Theme toggle.
 *
 * Cycles light → dark → system. Three states rather than two because "follow my
 * phone" is a real preference that a binary switch destroys. The choice is
 * stored in localStorage; the *initial* application happens in a blocking script
 * in `<head>` (see layout.tsx) so there is no flash of the wrong theme.
 */
type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'pl-theme';

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    setTheme(stored === 'light' || stored === 'dark' ? stored : 'system');
    setMounted(true);
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);

    if (next === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setDomTheme(prefersDark ? 'dark' : 'light');
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
      setDomTheme(next);
    }
  };

  const cycle = () => {
    apply(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');
  };

  const label =
    theme === 'light'
      ? 'Theme: light. Switch to dark'
      : theme === 'dark'
        ? 'Theme: dark. Switch to match your device'
        : 'Theme: matching your device. Switch to light';

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className={
        className ??
        'flex h-11 w-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink'
      }
    >
      {/* Until mounted we render the neutral icon; the label carries the state
          for assistive technology either way, so there is nothing misleading. */}
      {!mounted || theme === 'system' ? (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8.5 20h7M12 16.5V20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : theme === 'light' ? (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

/** Apply the theme to the document. Kept in one place so the script and the
 *  runtime toggle can never disagree about which attributes matter. */
function setDomTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;

  // Let the browser repaint form controls and scrollbars to match.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#12100e' : '#faf7f2');
}
