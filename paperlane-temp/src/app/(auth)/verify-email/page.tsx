import type { Metadata } from 'next';
import Link from 'next/link';

import { db } from '@/server/db';
import { sha256 } from '@/lib/crypto';
import { VerifyEmailButton } from './VerifyEmailButton';
import { ResendVerificationForm } from './ResendVerificationForm';

export const metadata: Metadata = {
  title: 'Confirm your email',
  robots: { index: false, follow: false },
};

/**
 * Email confirmation.
 *
 * The confirmation is a **button, not a page load**, and that is deliberate:
 * corporate mail scanners and link previewers fetch every URL in an email. If
 * the GET consumed the token, a large share of customers would arrive to find
 * their link "already used" by a robot. So the page only *looks up* the token to
 * decide what to say, and the mutation happens on submit.
 *
 * The lookup reveals nothing useful to a stranger: it reports whether a token
 * exists and whether it is spent or expired — never whose account it belongs to.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';

  const record = token
    ? await db.token
        .findUnique({
          where: { tokenHash: sha256(token) },
          select: { type: true, usedAt: true, expiresAt: true },
        })
        .catch(() => null)
    : null;

  const isEmailToken = record?.type === 'email_verify';
  const alreadyUsed = Boolean(isEmailToken && record?.usedAt);
  const expired = Boolean(isEmailToken && !record?.usedAt && record!.expiresAt < new Date());

  return (
    <div className="text-center">
      <h1 className="font-display text-xl font-semibold text-ink">Confirm your email</h1>

      {!token || !isEmailToken ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            This link is not complete — confirmation links only work straight from the email we sent.
          </p>
          <div className="mt-6 text-left">
            <ResendVerificationForm />
          </div>
        </>
      ) : alreadyUsed ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            This address is already confirmed. Nothing more to do.
          </p>
          <div className="mt-6">
            <Link
              href="/account"
              className="text-sm font-medium text-ink underline underline-offset-4"
            >
              Go to your account
            </Link>
          </div>
        </>
      ) : expired ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            This link has expired. Confirmation links last 24 hours — send yourself a fresh one below.
          </p>
          <div className="mt-6 text-left">
            <ResendVerificationForm />
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            One tap and your address is confirmed. We ask so that order confirmations and delivery updates
            actually reach you.
          </p>
          <div className="mt-6">
            <VerifyEmailButton token={token} />
          </div>
        </>
      )}
    </div>
  );
}
