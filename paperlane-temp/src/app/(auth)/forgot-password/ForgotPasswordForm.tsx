'use client';

import { useActionState } from 'react';

import { forgotPasswordAction } from '@/app/actions/auth';
import { IDLE } from '@/app/actions/types';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Form';

/**
 * Password-reset request.
 *
 * The success message is identical whether or not the address is registered, and
 * the server sends the same message either way. Anything else turns this form
 * into a way to test which emails shop here.
 */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, IDLE);

  const fieldError = (name: string) => (state.ok ? undefined : state.fieldErrors?.[name]);

  return (
    <form action={formAction} noValidate className="space-y-4">
      {!state.ok && state.error && (
        <Alert tone="danger" live="assertive">
          {state.error}
        </Alert>
      )}

      {state.ok && (
        <Alert tone="success" live="polite">
          {state.message ??
            'If that address has an account, a reset link is on its way. It expires in one hour.'}
        </Alert>
      )}

      <Input
        label="Email"
        name="email"
        id="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        error={fieldError('email')}
      />

      <Button type="submit" variant="primary" fullWidth loading={pending} loadingLabel="Sending">
        Send reset link
      </Button>

      <p className="text-center text-xs leading-relaxed text-ink-faint">
        Nothing arriving? Check your spam folder first — transactional mail occasionally lands there — then
        ask us and we will sort it out.
      </p>
    </form>
  );
}
