import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/server/auth';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Paper Lantern Books account.',
};

/**
 * `redirectTo` is threaded through so a customer sent here from checkout lands
 * back where they were, rather than on a generic account page. Only same-site
 * paths are honoured — see the check below — because an open redirect on a login
 * page is a phishing primitive.
 */
function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  return value.slice(0, 300);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect('/account');

  const params = await searchParams;
  const redirectTo = safeRedirect(params.redirect);

  const notice = params.verified === '1';

  return (
    <>
      {notice && (
        <p className="mb-4 rounded-xl border border-line bg-paper-soft px-3.5 py-3 text-sm text-ink-soft">
          Your email is confirmed. Sign in to continue.
        </p>
      )}
      <LoginForm redirectTo={redirectTo} />
    </>
  );
}
