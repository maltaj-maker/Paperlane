'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';

import { resetPasswordAction } from '@/app/actions/auth';
import { IDLE } from '@/app/actions/types';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Form';

/**
 * Consume a reset token and set a new password.
 *
 * On success the server revokes every existing session for that account (see
 * `resetPasswordAction`). That is the whole point of a reset: if someone reset it
 * because they believed their account was compromised, leaving the attacker's
 * session alive would make the reset theatre.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, IDLE);
  const [showPassword, setShowPassword] = useState(false);

  const fieldError = (name: string) => (state.ok ? undefined : state.fieldErrors?.[name]);

  if (state.ok) {
    return (
      <div className="space-y-4">
        <Alert tone="success" live="polite">
          {state.message ?? 'Your password has been changed. You can sign in now.'}
        </Alert>
        <Button href="/login" variant="primary" fullWidth>
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-4">
      {state.error && (
        <Alert tone="danger" live="assertive">
          {state.error}
        </Alert>
      )}

      <input type="hidden" name="token" value={token} />

      <Input
        label="New password"
        name="password"
        id="password"
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        required
        error={fieldError('password')}
        hint="At least 8 characters."
        addonRight={
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="pointer-events-auto text-xs font-medium text-ink-muted hover:text-ink"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        }
      />

      <Input
        label="Confirm new password"
        name="confirmPassword"
        id="confirmPassword"
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        required
        error={fieldError('confirmPassword')}
      />

      <Button type="submit" variant="primary" fullWidth loading={pending} loadingLabel="Saving">
        Set new password
      </Button>

      <p className="text-center text-xs text-ink-faint">
        Changed your mind?{' '}
        <Link href="/login" className="underline underline-offset-2 hover:text-ink-muted">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
