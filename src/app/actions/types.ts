/**
 * Shared shapes for server actions.
 *
 * Every action returns a discriminated result rather than throwing, so a form
 * can render field-level errors without a try/catch and without a full page
 * reload. Actions that need to redirect do so via `redirect()` from next/navigation.
 */

export type ActionState<TData = undefined> =
  | {
      ok: true;
      message?: string;
      data?: TData;
    }
  | {
      ok: false;
      error: string;
      /** Stable code the client can branch on, e.g. OUT_OF_STOCK. */
      code?: string;
      /** Field-level validation messages, keyed by form field name. */
      fieldErrors?: Record<string, string[]>;
      /** Offer a retry affordance for transient failures. */
      retryable?: boolean;
    };

export const ok = <TData = undefined>(data?: TData, message?: string): ActionState<TData> => ({
  ok: true,
  data,
  message,
});

export const fail = (
  error: string,
  options: { code?: string; fieldErrors?: Record<string, string[]>; retryable?: boolean } = {},
): ActionState<never> => ({
  ok: false,
  error,
  code: options.code,
  fieldErrors: options.fieldErrors,
  retryable: options.retryable,
});

/** Initial state for `useActionState`. */
export const IDLE: ActionState<never> = { ok: false, error: '' };

/**
 * Convert a thrown error into an action result.
 * Logs the real cause server-side; returns something safe to display.
 */
export function fromError(err: unknown): ActionState<never> {
  if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
    // Structurally an AppError from src/lib/errors.ts. Narrow through `unknown`
    // rather than asserting, so a look-alike object cannot slip through.
    const candidate = err as unknown as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
      retryable?: unknown;
    };
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return fail(candidate.message, {
        code: candidate.code,
        fieldErrors: candidate.details as Record<string, string[]> | undefined,
        retryable: candidate.retryable === true,
      });
    }
  }

  console.error('[action] unhandled error', err);

  return fail('Something went wrong on our side. Please try again in a moment.', {
    code: 'INTERNAL_ERROR',
    retryable: true,
  });
}

/** Zod issues → field error map. */
export function zodFieldErrors(issues: Array<{ path: (string | number)[]; message: string }>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join('.') || 'form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Get a trimmed string from FormData, or undefined when blank. */
export function formString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function formNumber(formData: FormData, key: string): number | undefined {
  const raw = formString(formData, key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formBoolean(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === 'on' || value === 'true' || value === '1';
}

export function formStrings(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}
