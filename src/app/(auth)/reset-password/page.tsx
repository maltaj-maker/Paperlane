import type { Metadata } from 'next';
import Link from 'next/link';

import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Set a new password',
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="font-display text-xl font-semibold text-ink">That link is incomplete</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Reset links only work from the email we sent — they cannot be typed in by hand. Request a fresh
          one and use the button in the new email.
        </p>
        <div className="mt-5">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-ink underline underline-offset-4"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <header>
        <h1 className="font-display text-xl font-semibold text-ink">Set a new password</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Choose something you have not used here before.
        </p>
      </header>

      <div className="mt-5">
        <ResetPasswordForm token={token} />
      </div>
    </>
  );
}
