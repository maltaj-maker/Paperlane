import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';

import './globals.css';
import { env } from '@/lib/env';
import { ToastProvider } from '@/components/ui/Toast';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { AnnouncementBar } from '@/components/layout/AnnouncementBar';
import { SkipLink } from '@/components/layout/SkipLink';
import { AnalyticsScripts } from '@/components/analytics/AnalyticsScripts';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { ConsentBanner } from '@/components/legal/ConsentBanner';

/**
 * Root layout.
 *
 * Server-rendered shell: header, footer and the skip link are static HTML so
 * there is no layout shift or spinner on first paint. Only the genuinely
 * interactive islands are client components.
 *
 * The theme is applied by a blocking inline script *before* first paint. Doing
 * it in React would produce a visible flash of the wrong theme on every
 * navigation, which looks broken.
 */

const APP_URL = env().APP_URL;

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: `${env().APP_NAME} — Independent online bookshop`,
    template: `%s · ${env().APP_NAME}`,
  },
  description:
    'Handpicked books, honest reviews and fast delivery across India. Browse new releases, bestsellers and staff picks from an independent bookshop.',
  applicationName: env().APP_NAME,
  authors: [{ name: env().APP_NAME }],
  creator: env().APP_NAME,
  publisher: env().APP_NAME,
  formatDetection: {
    // Stop iOS turning ISBNs and prices into tappable phone links.
    telephone: false,
    address: false,
    email: false,
  },
  openGraph: {
    type: 'website',
    siteName: env().APP_NAME,
    locale: 'en_IN',
    url: APP_URL,
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: APP_URL,
  },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: env().APP_NAME,
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never block zoom — pinching to read a small ISBN is a legitimate need.
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FCF9F4' },
    { media: '(prefers-color-scheme: dark)', color: '#14110E' },
  ],
  colorScheme: 'light dark',
};

/**
 * Applies the persisted theme before paint.
 * Kept as a string so it can be inlined ahead of the bundle.
 * Falls back to the OS preference when nothing is stored.
 */
const THEME_INIT_SCRIPT = `
(function(){
  try {
    var stored = localStorage.getItem('pl-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'light' || stored === 'dark' ? stored : (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        {/* Must run before any paint. See THEME_INIT_SCRIPT above. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://covers.openlibrary.org" crossOrigin="" />
      </head>

      <body className="min-h-dvh antialiased">
        <SkipLink />

        <ToastProvider>
          <div className="flex min-h-dvh flex-col">
            <Suspense fallback={<div className="h-[57px] border-b border-line" aria-hidden="true" />}>
              <AnnouncementBar />
            </Suspense>

            <Suspense fallback={<div className="h-16 border-b border-line" aria-hidden="true" />}>
              <Header />
            </Suspense>

            <main id="main" className="flex-1 focus-visible:outline-none" tabIndex={-1}>
              {children}
            </main>

            <Footer />
          </div>

          <ConsentBanner />
        </ToastProvider>

        <AnalyticsScripts />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
