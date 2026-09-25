import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = {
  title: 'Reset your password',
  description: 'Request a password reset link for your Paper Lantern Books account.',
};

export default function ForgotPasswordPage() {
  return (
    <>
      <header>
        <h1 className="font-display text-xl font-semibold text-ink">Forgot your password?</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Enter your email and we will send a link to set a new one.
        </p>
      </header>

      <div className="mt-5">
        <ForgotPasswordForm />
      </div>

      <p className="mt-5 text-center text-sm text-ink-muted">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
