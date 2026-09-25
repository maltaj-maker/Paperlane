/** @type {import('next').NextConfig} */

const isProd = process.env.NODE_ENV === 'production';

/**
 * Content-Security-Policy.
 *
 * Next.js injects inline bootstrap scripts, so 'unsafe-inline' is required for
 * scripts unless nonces are wired through middleware. We keep `script-src` tight
 * everywhere else (self + the analytics providers we actually allow), and vary
 * the policy between dev and prod so local DX does not require disabling CSP.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  isProd
    ? "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  isProd
    ? "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com"
    : "connect-src 'self' ws: wss:",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  // Server Actions are same-origin by default; this additionally restricts
  // which hosts may invoke them (defence-in-depth against CSRF via proxying).
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
      allowedOrigins: [
        process.env.APP_URL?.replace(/^https?:\/\//, '') || 'localhost:3000',
      ].filter(Boolean),
    },
  },

  images: {
    // Modern formats first — Book covers dominate our byte budget.
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [320, 375, 420, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [64, 96, 128, 200, 256, 300, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      { protocol: 'https', hostname: 'covers.openlibrary.org' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
    ],
  },

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Never let a service worker or a catalogue page be cached by a CDN
        // in a way that could serve stale prices or stale stock.
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },

  async redirects() {
    return [
      // Legacy / typo URL rescue — protects inbound Instagram links.
      { source: '/book/:slug', destination: '/books/:slug', permanent: true },
      { source: '/product/:slug', destination: '/books/:slug', permanent: true },
      { source: '/shop', destination: '/books', permanent: true },
      { source: '/category/:slug', destination: '/genres/:slug', permanent: true },
    ];
  },

  logging: {
    fetches: { fullUrl: process.env.NODE_ENV !== 'production' },
  },
};

export default nextConfig;
