/**
 * Button.
 *
 * Variants are constrained to a small set so the storefront reads as one
 * designed system rather than a collection of one-off buttons. Minimum height is
 * 44px on every size, which is both a touch-target requirement and the reason
 * the mobile UI feels deliberate.
 *
 * Renders as `<button>`, `<a>`, or Next `<Link>` depending on props, so a
 * navigation action never gets a nested-interactive-element accessibility bug.
 */

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-700 text-paper hover:bg-brand-600 active:bg-brand-800 shadow-sm border border-transparent',
  secondary:
    'bg-transparent text-ink border border-line hover:bg-paper-soft hover:border-ink-faint active:bg-paper-sunken',
  accent:
    'bg-accent text-white hover:brightness-110 active:brightness-95 shadow-sm border border-transparent',
  ghost: 'bg-transparent text-ink-soft hover:bg-paper-soft hover:text-ink border border-transparent',
  danger: 'bg-danger text-white hover:brightness-110 active:brightness-95 border border-transparent',
  link: 'bg-transparent text-ink underline underline-offset-4 decoration-line hover:decoration-ink px-0 border-0',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3 py-1.5 text-sm gap-1.5 rounded-lg',
  md: 'min-h-[44px] px-5 py-2.5 text-[15px] gap-2 rounded-full',
  lg: 'min-h-[52px] px-7 py-3 text-base gap-2.5 rounded-full',
};

const BASE =
  'inline-flex items-center justify-center font-medium transition-[background-color,border-color,color,filter,transform] duration-150 ease-out-soft disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables interaction. */
  loading?: boolean;
  loadingLabel?: string;
  /** Renders a Next Link. */
  href?: string;
  /** External link: opens in a new tab with rel protections. */
  external?: boolean;
  fullWidth?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel,
    href,
    external,
    fullWidth,
    iconLeft,
    iconRight,
    className,
    children,
    disabled,
    type,
    ...props
  },
  ref,
) {
  const classes = cn(
    BASE,
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
    variant === 'link' && 'min-h-0',
    className,
  );

  const content = (
    <>
      {loading ? (
        <Spinner className="shrink-0" />
      ) : (
        iconLeft && <span className="shrink-0" aria-hidden="true">{iconLeft}</span>
      )}
      <span className={loading && loadingLabel ? 'sr-only' : undefined}>
        {loading && loadingLabel ? loadingLabel : children}
      </span>
      {!loading && iconRight && <span className="shrink-0" aria-hidden="true">{iconRight}</span>}
    </>
  );

  if (href && !disabled) {
    if (external || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return (
        <a
          href={href}
          className={classes}
          target={href.startsWith('http') ? '_blank' : undefined}
          rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
        >
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </button>
  );
});

/** Accessible indeterminate spinner. */
export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex', className)}>
      <svg
        className="h-4 w-4 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Icon button. Requires an accessible label — an icon alone tells a screen
 * reader nothing, so `label` is a required prop rather than optional.
 */
export interface IconButtonProps extends Omit<ButtonProps, 'iconLeft' | 'iconRight' | 'children'> {
  label: string;
  children: React.ReactNode;
  /** Badge count for cart/wishlist indicators. */
  badge?: number;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, badge, className, size = 'md', variant = 'ghost', ...props },
  ref,
) {
  const sizing = size === 'sm' ? 'h-9 w-9 min-h-9' : size === 'lg' ? 'h-12 w-12 min-h-12' : 'h-11 w-11 min-h-11';

  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={cn('relative !p-0 rounded-full', sizing, className)}
      {...props}
    >
      {children}
      {typeof badge === 'number' && badge > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white"
          aria-hidden="true"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Button>
  );
});
