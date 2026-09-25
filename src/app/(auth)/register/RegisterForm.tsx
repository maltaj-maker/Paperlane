'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';

import { registerAction } from '@/app/actions/auth';
import { IDLE } from '@/app/actions/types';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Input, Checkbox } from '@/components/ui/Form';

/**
 * Create an account.
 *
 * The password rules are shown *before* the customer types, not after they fail —
 * a length hint up front prevents the "your password is too short" round trip
 * that loses people on mobile.
 *
 * The marketing checkbox is unticked. Consent has to be a deliberate act; a
 * pre-ticked box is not consent, and it is the kind of thing that gets a small
 * shop's sending domain blacklisted.
 */
export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, IDLE);
  const [showPassword, setShowPassword] = useState(false);

  const fieldError = (name: string) => (state.ok ? undefined : state.fieldErrors?.[name]);

  return (
    <form action={formAction} noValidate className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold text-ink">Create your account</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Save your wishlist, track orders and get told when a book is back.
        </p>
      </header>

      {!state.ok && state.error && (
        <Alert tone="danger" live="assertive">
          {state.error}
        </Alert>
      )}

      <Input
        label="Full name"
        name="name"
        id="name"
        autoComplete="name"
        required
        error={fieldError('name')}
      />

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
        hint="We send order confirmations here."
      />

      <Input
        label="Phone (optional)"
        name="phone"
        id="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        error={fieldError('phone')}
        hint="Only used for delivery updates on orders you place."
      />

      <Input
        label="Password"
        name="password"
        id="password"
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        required
        error={fieldError('password')}
        hint="At least 8 characters. A short phrase you will remember beats a jumble you will not."
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

      {/*
        Honeypot: hidden from people, irresistible to scripted sign-ups. Real
        bots fill it, real customers never see it, and the server rejects any
        submission where it is non-empty.
      */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <Checkbox
        name="marketingEmailConsent"
        id="marketingEmailConsent"
        label={
          <>
            Email me occasional notes about new arrivals and staff picks. Two or three a month at most, and
            every one has an unsubscribe link.
          </>
        }
      />

      <Button type="submit" variant="primary" fullWidth loading={pending} loadingLabel="Creating account">
        Create account
      </Button>

      <p className="text-center text-xs leading-relaxed text-ink-faint">
        By creating an account you agree to our{' '}
        <Link href="/legal/terms" className="underline underline-offset-2 hover:text-ink-muted">
          terms
        </Link>{' '}
        and{' '}
        <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-ink-muted">
          privacy policy
        </Link>
        .
      </p>

      <p className="pt-1 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
