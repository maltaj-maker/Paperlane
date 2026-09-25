/**
 * Feedback primitives: Alert, EmptyState, ErrorState, Skeleton, Badge,
 * StockBadge, Spinner-overlay.
 *
 * These carry most of the app's "is this thing alive?" communication. A shop
 * that says nothing while loading loses trust; one that says the wrong thing
 * loses more. So each state is explicit and none of them is decorative.
 */

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_STYLES: Record<AlertTone, { wrap: string; icon: string }> = {
  info: { wrap: 'border-info/30 bg-info/5 text-ink', icon: 'text-info' },
  success: { wrap: 'border-success/30 bg-success/5 text-ink', icon: 'text-success' },
  warning: { wrap: 'border-warning/35 bg-warning/5 text-ink', icon: 'text-warning' },
  danger: { wrap: 'border-danger/35 bg-danger/5 text-ink', icon: 'text-danger' },
};

const ALERT_ICONS: Record<AlertTone, React.ReactNode> = {
  info: (
    <path d="M8 7.5v5M8 4.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  ),
  success: (
    <path d="M4 8.5l2.5 2.5L12 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  warning: (
    <path d="M8 2.8l5.6 9.7H2.4L8 2.8zM8 6.5v2.5M8 10.8h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  danger: (
    <path d="M8 5v3.5M8 11h.01M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  ),
};

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  /** Renders a dismiss control. */
  onDismiss?: () => void;
  action?: { label: string; href?: string; onClick?: () => void };
  className?: string;
  /** `alert` interrupts a screen reader; use for failures. `status` is polite. */
  live?: 'off' | 'polite' | 'assertive';
}

export function Alert({ tone = 'info', title, children, onDismiss, action, className, live }: AlertProps) {
  const styles = ALERT_STYLES[tone];
  const role = live === 'assertive' || tone === 'danger' ? 'alert' : live === 'polite' ? 'status' : undefined;

  return (
    <div
      role={role}
      aria-live={live && live !== 'off' ? live : undefined}
      className={cn('flex gap-3 rounded-xl border p-3.5 text-sm', styles.wrap, className)}
    >
      <svg className={cn('mt-0.5 h-4 w-4 shrink-0', styles.icon)} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {ALERT_ICONS[tone]}
      </svg>

      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {children && <div className={cn('leading-relaxed text-ink-soft', title && 'mt-1')}>{children}</div>}

        {action && (
          <div className="mt-2.5">
            {action.href ? (
              <Link
                href={action.href}
                className="text-sm font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                {action.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={action.onClick}
                className="text-sm font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 h-8 w-8 shrink-0 rounded-full text-ink-muted transition-colors hover:bg-paper-soft hover:text-ink"
        >
          <svg className="mx-auto h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  secondaryAction?: { label: string; href: string };
  className?: string;
}

/** Shown when a list is legitimately empty — never for errors. */
export function EmptyState({ icon, title, description, action, secondaryAction, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-paper-soft text-ink-muted" aria-hidden="true">
        {icon ?? (
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 5.5A1.5 1.5 0 015.5 4H10a2 2 0 012 2v13a1.5 1.5 0 00-1.5-1.5H5.5A1.5 1.5 0 014 16V5.5zM20 5.5A1.5 1.5 0 0018.5 4H14a2 2 0 00-2 2v13a1.5 1.5 0 011.5-1.5h5A1.5 1.5 0 0020 16V5.5z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      <h3 className="text-lg font-semibold text-ink">{title}</h3>

      {description && <div className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">{description}</div>}

      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action &&
            (action.href ? (
              <Button href={action.href}>{action.label}</Button>
            ) : (
              <Button onClick={action.onClick}>{action.label}</Button>
            ))}
          {secondaryAction && (
            <Button href={secondaryAction.href} variant="ghost">
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: React.ReactNode;
  /** Retry handler. Offered whenever the failure is plausibly transient. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Reference code shown to the customer so support can find the incident. */
  incidentId?: string;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load this just now. It is usually temporary — please try again.',
  onRetry,
  retryLabel = 'Try again',
  incidentId,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)} role="alert">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger" aria-hidden="true">
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 8v5M12 16.5h.01M10.3 3.9L2.6 17.2A1.9 1.9 0 004.3 20h15.4a1.9 1.9 0 001.7-2.8L13.7 3.9a1.9 1.9 0 00-3.4 0z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <div className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">{description}</div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {onRetry && (
          <Button onClick={onRetry} iconLeft={
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2v3h-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }>
            {retryLabel}
          </Button>
        )}
        <Button href="/" variant="ghost">
          Back to the shop
        </Button>
      </div>

      {incidentId && (
        <p className="mt-4 font-mono text-2xs text-ink-faint">Reference: {incidentId}</p>
      )}
    </div>
  );
}

/** Skeleton block. `lines` renders paragraph-shaped placeholders. */
export function Skeleton({ className, lines, rounded = 'md' }: { className?: string; lines?: number; rounded?: 'sm' | 'md' | 'full' }) {
  if (lines && lines > 1) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className={cn('skeleton h-4', rounded === 'full' ? 'rounded-full' : 'rounded', index === lines - 1 && 'w-3/5', className)}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn('skeleton h-4', rounded === 'full' ? 'rounded-full' : rounded === 'sm' ? 'rounded' : 'rounded-lg', className)}
    />
  );
}

/** Product-grid skeleton, matched to real card dimensions to avoid layout shift. */
export function BookGridSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="space-y-3">
          <div className="skeleton aspect-[2/3] w-full rounded-lg" />
          <div className="skeleton h-4 w-5/6 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
          <div className="skeleton h-4 w-1/3 rounded" />
        </div>
      ))}
    </div>
  );
}

/** Announced to screen readers while content loads. */
export function LoadingAnnouncement({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {label}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const BADGE_STYLES: Record<BadgeTone, string> = {
  neutral: 'bg-paper-sunken text-ink-soft',
  accent: 'bg-accent text-white',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/12 text-danger',
  info: 'bg-info/12 text-info',
  outline: 'border border-line text-ink-muted',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  size = 'md',
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium leading-none',
        size === 'sm' ? 'px-2 py-1 text-2xs' : 'px-2.5 py-1.5 text-xs',
        BADGE_STYLES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Stock indicator.
 *
 * Copy is specific on purpose. "Only 2 left" nudges without lying, and "Out of
 * stock" is stated plainly rather than hidden — customers who discover a fake
 * "in stock" at checkout do not come back.
 */
export function StockBadge({
  status,
  available,
  className,
  showCount = true,
}: {
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'preorder';
  available?: number;
  className?: string;
  showCount?: boolean;
}) {
  if (status === 'out_of_stock') {
    return (
      <Badge tone="neutral" className={className}>
        Out of stock
      </Badge>
    );
  }

  if (status === 'preorder') {
    return (
      <Badge tone="info" className={className}>
        Available to pre-order
      </Badge>
    );
  }

  if (status === 'low_stock') {
    return (
      <Badge tone="warning" className={className}>
        {showCount && available !== undefined && available <= 5
          ? `Only ${available} left`
          : 'Low stock'}
      </Badge>
    );
  }

  return (
    <Badge tone="success" className={className}>
      In stock
    </Badge>
  );
}
