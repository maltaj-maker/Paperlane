'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';

import { loginAction } from '@/app/actions/auth';
import { IDLE } from '@/app/actions/types';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Input, Checkbox } from '@/components/ui/Form';

/**
 * Sign in.
 *
 * Two things that matter more than they look:
 *
 *  1. **One generic error.** "No account with that email" versus "wrong password"
 *     is a free account-enumeration oracle; both say the same thing here.
 *  2. **`autoComplete` is set correctly.** It is the difference between a
 *     password manager filling the form on a phone and a customer typing a long
 *     password on a touch keyboard.
 */
export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, IDLE);
  const [showPassword, setShowPassword] = useState(false);

  const fieldError = (name: string) => (state.ok ? undefined : state.fieldErrors?.[name]);

  return (
    <form action={formAction} noValidate className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold text-ink">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-muted">Sign in to see your orders and wishlist.</p>
      </header>

      {!state.ok && state.error && (
        <Alert tone="danger" live="assertive">
          {state.error}
        </Alert>
      )}

      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}

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

      <Input
        label="Password"
        name="password"
        id="password"
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        required
        error={fieldError('password')}
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

      <div className="flex items-center justify-between gap-4">
        <Checkbox label="Keep me signed in" name="rememberMe" id="rememberMe" defaultChecked />
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-ink underline-offset-4 hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <Button type="submit" variant="primary" fullWidth loading={pending} loadingLabel="Signing in">
        Sign in
      </Button>

      <p className="pt-1 text-center text-sm text-ink-muted">
        New here?{' '}
        <Link href="/register" className="font-medium text-ink underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>

      <p className="text-center text-xs leading-relaxed text-ink-faint">
        You can also check out as a guest — we only ask for an account if you want order history.
      </p>
    </form>
  );
}
