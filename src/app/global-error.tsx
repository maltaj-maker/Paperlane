'use client';

/**
 * Last-resort boundary: this renders when the root layout itself has failed, so
 * it cannot rely on our providers, fonts, theme script or CSS variables having
 * loaded. Everything here is inline and self-contained on purpose.
 *
 * It is deliberately plain. A page that tries to look premium while the app is
 * broken reads worse than one that is honestly simple.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#faf7f2',
          color: '#221c16',
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '30rem', textAlign: 'center' }}>
          <p
            style={{
              fontSize: '0.75rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: '#8a7d6d',
              margin: 0,
            }}
          >
            Something went wrong
          </p>

          <h1 style={{ fontSize: '1.5rem', margin: '16px 0 0', lineHeight: 1.25 }}>
            The shop could not start
          </h1>

          <p style={{ fontSize: '0.9375rem', lineHeight: 1.6, color: '#5c5349', margin: '12px 0 0' }}>
            This is on our side, not yours. Reloading usually helps. If it does not, please try again in a
            few minutes — your orders and payments are unaffected.
          </p>

          {error.digest && (
            <p
              style={{
                margin: '20px 0 0',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.75rem',
                color: '#5c5349',
              }}
            >
              Reference {error.digest}
            </p>
          )}

          <div
            style={{
              marginTop: '28px',
              display: 'flex',
              gap: '12px',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={reset}
              type="button"
              style={{
                minHeight: '44px',
                padding: '0 20px',
                borderRadius: '999px',
                border: 'none',
                background: '#221c16',
                color: '#faf7f2',
                fontSize: '0.9375rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>

            {/*
              A plain anchor, not a Next <Link>: this boundary exists because
              routing may itself be broken, so a full document load is the point.
            */}
            <a
              href="/"
              style={{
                minHeight: '44px',
                padding: '0 20px',
                borderRadius: '999px',
                border: '1px solid #ddd3c4',
                color: '#221c16',
                fontSize: '0.9375rem',
                fontWeight: 500,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Go to the homepage
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
