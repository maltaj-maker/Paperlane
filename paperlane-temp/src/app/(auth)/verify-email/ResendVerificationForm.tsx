'use client';

import { useActionState } from 'react';

import { resendVerificationAction } from '@/app/actions/auth';
import { IDLE } from '@/app/actions/types';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';

/**
 * "Send me a new link."
 *
 * Requires being signed in — `resendVerificationAction` reads the session rather
 * than accepting an email address from the form. Otherwise this becomes an
 * unauthenticated way to email arbitrary people from our domain, which is both a
 * spam vector and a reputation risk.
 */
export function ResendVerificationForm() {
  const [state, formAction, pending] = useActionState(resendVerificationAction, IDLE);

  if (state.ok) {
    return (
      <Alert tone="success" live="polite">
        {state.message ?? 'A new confirmation link is on its way.'}
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && (
        <Alert tone="danger" live="assertive">
          {state.error}
        </Alert>
      )}

      <p className="text-sm leading-relaxed text-ink-muted">
        Signed in already? Send a fresh confirmation link to your account email.
      </p>

      <Button type="submit" variant="secondary" fullWidth loading={pending} loadingLabel="Sending">
        Send a new link
      </Button>
    </form>
  );
}
