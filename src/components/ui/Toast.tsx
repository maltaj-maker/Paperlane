'use client';

/**
 * Toast notifications.
 *
 * A single provider mounted in the root layout exposes `useToast()`. Toasts are
 * rendered into an `aria-live` region so screen-reader users hear confirmations
 * like "Added to basket" without the focus being yanked anywhere.
 *
 * The provider also owns the app-wide "unsaved changes" guard used by the cart,
 * because both need the same imperative escape hatch from server actions.
 */

import * as React from 'react';
import { cn } from '@/lib/cn';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss. Errors default to staying put. */
  duration?: number;
  action?: { label: string; href?: string; onClick?: () => void };
}

interface ToastContextValue {
  toast: (input: Omit<Toast, 'id'>) => string;
  success: (title: string, description?: string, action?: Toast['action']) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string, action?: Toast['action']) => string;
  warning: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>.');
  }
  return context;
}

const DEFAULT_DURATION = 4_500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = React.useCallback(
    (input: Omit<Toast, 'id'>) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item: Toast = { ...input, id };

      // Cap the stack: more than three is noise, not information.
      setToasts((current) => [...current.slice(-2), item]);

      // Errors persist until dismissed — a failure the customer misses is a
      // support ticket waiting to happen.
      const duration = input.duration ?? (item.tone === 'error' ? 0 : DEFAULT_DURATION);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }

      return id;
    },
    [dismiss],
  );

  // Clear timers on unmount so a route change cannot fire a stale dismiss.
  React.useEffect(() => {
    const current = timers.current;
    return () => {
      current.forEach((timer) => clearTimeout(timer));
      current.clear();
    };
  }, []);

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description, action) => toast({ tone: 'success', title, description, action }),
      error: (title, description) => toast({ tone: 'error', title, description }),
      info: (title, description, action) => toast({ tone: 'info', title, description, action }),
      warning: (title, description) => toast({ tone: 'warning', title, description }),
      dismiss,
      dismissAll: () => {
        setToasts([]);
        timers.current.forEach((timer) => clearTimeout(timer));
        timers.current.clear();
      },
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const TONE_STYLES: Record<ToastTone, { wrap: string; icon: React.ReactNode }> = {
  success: {
    wrap: 'border-success/30',
    icon: (
      <svg className="h-5 w-5 text-success" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 10.5l2.2 2.2 4.8-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  error: {
    wrap: 'border-danger/35',
    icon: (
      <svg className="h-5 w-5 text-danger" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6v5M10 13.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  warning: {
    wrap: 'border-warning/35',
    icon: (
      <svg className="h-5 w-5 text-warning" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2.8l7.2 12.5H2.8L10 2.8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M10 8v3.2M10 13.4h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  info: {
    wrap: 'border-info/30',
    icon: (
      <svg className="h-5 w-5 text-info" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 9v5M10 6.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
};

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      // Bottom-centred on mobile (thumb-reachable, above the sticky cart bar);
      // bottom-right on desktop where it does not cover content.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-2 px-4 pb-4 sm:items-end sm:pb-6 sm:pr-6"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          className={cn(
            'pointer-events-auto w-full max-w-sm animate-fade-up rounded-xl border bg-paper p-3.5 shadow-book-lg',
            TONE_STYLES[toast.tone].wrap,
          )}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0">{TONE_STYLES[toast.tone].icon}</span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-ink">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{toast.description}</p>
              )}

              {toast.action && (
                <div className="mt-2">
                  {toast.action.href ? (
                    <a
                      href={toast.action.href}
                      className="text-xs font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                    >
                      {toast.action.label}
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={toast.action.onClick}
                      className="text-xs font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                    >
                      {toast.action.label}
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="-mr-1 -mt-1 h-8 w-8 shrink-0 rounded-full text-ink-faint transition-colors hover:bg-paper-soft hover:text-ink"
            >
              <svg className="mx-auto h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
