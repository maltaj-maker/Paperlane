/**
 * Form primitives: Field, Input, Textarea, Select, Checkbox.
 *
 * Accessibility is wired in, not bolted on:
 *  - Every control gets an id, and its label is bound with htmlFor.
 *  - Errors are announced (`aria-describedby` + `role="alert"`), and
 *    `aria-invalid` marks the field.
 *  - Hints and errors share one description slot so screen readers read the
 *    most relevant text rather than both.
 *
 * Inputs are 16px on mobile deliberately: anything smaller makes iOS Safari
 * zoom the viewport on focus, which is a jarring, conversion-costing bug.
 */

import * as React from 'react';
import { cn } from '@/lib/cn';

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | string[];
  required?: boolean;
  /** Hide the label visually but keep it for assistive tech. */
  hideLabel?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Wrapper providing label, hint, error and required indicator consistently. */
export function Field({ label, htmlFor, hint, error, required, hideLabel, className, children }: FieldProps) {
  const errors = Array.isArray(error) ? error : error ? [error] : [];
  const hasError = errors.length > 0;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;

  return (
    <div className={cn('w-full', className)}>
      <label
        htmlFor={htmlFor}
        className={cn(
          'mb-1.5 block text-sm font-medium text-ink',
          hideLabel && 'sr-only',
        )}
      >
        {label}
        {required && (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only">(required)</span>}
      </label>

      {children}

      {hint && !hasError && (
        <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-ink-muted">
          {hint}
        </p>
      )}

      {hasError && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium leading-relaxed text-danger">
          {errors.map((message, index) => (
            <span key={index} className="block">
              {message}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-xl border bg-paper px-3.5 py-3 text-base text-ink placeholder:text-ink-faint transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-muted';

const CONTROL_STATE = {
  normal: 'border-line hover:border-ink-faint focus:border-ink focus:outline-none',
  error: 'border-danger focus:border-danger',
};

function describedBy(id: string | undefined, hint: string | undefined, hasError: boolean) {
  if (hasError && id) return `${id}-error`;
  if (hint && id) return `${id}-hint`;
  return undefined;
}

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  hint?: React.ReactNode;
  error?: string | string[];
  /** Rendered inside the field on the right, e.g. a show/hide toggle. */
  addonRight?: React.ReactNode;
  addonLeft?: React.ReactNode;
  wrapClassName?: string;
  hideLabel?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, addonRight, addonLeft, className, wrapClassName, id, required, hideLabel, ...props },
  ref,
) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const hasError = Array.isArray(error) ? error.length > 0 : Boolean(error);

  return (
    <Field label={label} htmlFor={fieldId} hint={hint} error={error} required={required} hideLabel={hideLabel} className={wrapClassName}>
      <div className="relative">
        {addonLeft && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
            {addonLeft}
          </span>
        )}
        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy(fieldId, hint ? 'y' : undefined, hasError)}
          className={cn(
            CONTROL_BASE,
            hasError ? CONTROL_STATE.error : CONTROL_STATE.normal,
            Boolean(addonLeft) && 'pl-10',
            Boolean(addonRight) && 'pr-12',
            className,
          )}
          {...props}
        />
        {addonRight && <span className="absolute right-2 top-1/2 -translate-y-1/2">{addonRight}</span>}
      </div>
    </Field>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: React.ReactNode;
  error?: string | string[];
  wrapClassName?: string;
  hideLabel?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, wrapClassName, id, required, hideLabel, rows = 4, ...props },
  ref,
) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const hasError = Array.isArray(error) ? error.length > 0 : Boolean(error);

  return (
    <Field label={label} htmlFor={fieldId} hint={hint} error={error} required={required} hideLabel={hideLabel} className={wrapClassName}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy(fieldId, hint ? 'y' : undefined, hasError)}
        className={cn(
          CONTROL_BASE,
          'resize-y leading-relaxed',
          hasError ? CONTROL_STATE.error : CONTROL_STATE.normal,
          className,
        )}
        {...props}
      />
    </Field>
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: React.ReactNode;
  error?: string | string[];
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  wrapClassName?: string;
  hideLabel?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, className, wrapClassName, id, required, hideLabel, ...props },
  ref,
) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const hasError = Array.isArray(error) ? error.length > 0 : Boolean(error);

  return (
    <Field label={label} htmlFor={fieldId} hint={hint} error={error} required={required} hideLabel={hideLabel} className={wrapClassName}>
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy(fieldId, hint ? 'y' : undefined, hasError)}
          className={cn(
            CONTROL_BASE,
            'cursor-pointer appearance-none pr-10',
            hasError ? CONTROL_STATE.error : CONTROL_STATE.normal,
            className,
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </Field>
  );
});

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | string[];
}

/**
 * Checkbox with a 44px tap target even though the box is visually 20px — the
 * padding is the target, so it stays easy to hit on a phone in a moving auto.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, className, id, ...props },
  ref,
) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const hasError = Array.isArray(error) ? error.length > 0 : Boolean(error);

  return (
    <div className={cn('w-full', className)}>
      <label htmlFor={fieldId} className="flex cursor-pointer items-start gap-3 py-1.5">
        <span className="relative flex h-5 w-5 shrink-0 translate-y-0.5 items-center justify-center">
          <input
            ref={ref}
            id={fieldId}
            type="checkbox"
            aria-invalid={hasError || undefined}
            aria-describedby={hasError ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
            className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-line bg-paper transition-colors checked:border-brand-700 checked:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            {...props}
          />
          <svg
            className="pointer-events-none absolute h-3.5 w-3.5 text-paper opacity-0 transition-opacity peer-checked:opacity-100"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path d="M2.5 7.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-sm leading-relaxed text-ink-soft">{label}</span>
      </label>
      {hint && !hasError && (
        <p id={`${fieldId}-hint`} className="ml-8 text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={`${fieldId}-error`} role="alert" className="ml-8 text-xs font-medium text-danger">
          {Array.isArray(error) ? error.join(' ') : error}
        </p>
      )}
    </div>
  );
});

export interface RadioGroupProps {
  name: string;
  legend: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; description?: string; disabled?: boolean; icon?: React.ReactNode }>;
  error?: string;
  className?: string;
  /** Stack vertically (default) or lay out as selectable cards. */
  layout?: 'stack' | 'cards';
}

/**
 * Radio group built on a real fieldset/legend with native radios, so keyboard
 * arrow navigation works exactly as users expect without custom key handling.
 */
export function RadioGroup({ name, legend, value, onChange, options, error, className, layout = 'stack' }: RadioGroupProps) {
  const groupId = React.useId();

  return (
    <fieldset className={cn('w-full', className)} aria-describedby={error ? `${groupId}-error` : undefined}>
      <legend className="mb-2 text-sm font-medium text-ink">{legend}</legend>

      <div className={cn(layout === 'cards' ? 'grid gap-2.5' : 'space-y-1')}>
        {options.map((option) => {
          const optionId = `${name}-${option.value}`;
          const checked = value === option.value;

          if (layout === 'cards') {
            return (
              <label
                key={option.value}
                htmlFor={optionId}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
                  checked ? 'border-ink bg-paper-soft' : 'border-line hover:border-ink-faint',
                  option.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <input
                  type="radio"
                  id={optionId}
                  name={name}
                  value={option.value}
                  checked={checked}
                  disabled={option.disabled}
                  onChange={() => onChange(option.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
                />
                {option.icon && <span className="shrink-0 text-ink-muted">{option.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{option.description}</span>
                  )}
                </span>
              </label>
            );
          }

          return (
            <label key={option.value} htmlFor={optionId} className="flex cursor-pointer items-center gap-3 py-2">
              <input
                type="radio"
                id={optionId}
                name={name}
                value={option.value}
                checked={checked}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="h-4 w-4 accent-[rgb(var(--accent))]"
              />
              <span className="text-sm text-ink">{option.label}</span>
            </label>
          );
        })}
      </div>

      {error && (
        <p id={`${groupId}-error`} role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
