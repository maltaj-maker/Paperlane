'use client';

import { useActionState } from 'react';

import { verifyEmailAction } from '@/app/actions/auth';
import { IDLE } from '@/app/actions/types';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';

/**
 * The mutation half of email confirmation.
 *
 * Kept as a separate submit so a link prefetch cannot burn the token, and so the
 * customer sees a deliberate "confirmed" state rather than a page that silently
 * did something.
 */
export function VerifyEmailButton({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(verifyEmailAction, IDLE);

  if (state.ok) {
    return (
      <div className="space-y-4 text-left">
        <Alert tone="success" live="polite">
          {state.message ?? 'Your email is confirmed. Thank you.'}
        </Alert>
        <Button href="/login?verified=1" variant="primary" fullWidth>
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert tone="danger" live="assertive">
          {state.error}
        </Alert>
      )}

      <input type="hidden" name="token" value={token} />

      <Button type="submit" variant="primary" fullWidth loading={pending} loadingLabel="Confirming">
        Confirm my email
      </Button>
    </form>
  );
}
