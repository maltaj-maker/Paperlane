'use client';

/**
 * Dialog / Modal.
 *
 * Built on the native `<dialog>` element, which gives us:
 *  - top-layer stacking (no z-index arms race with sticky headers),
 *  - a real focus trap and inert background from the browser itself,
 *  - Escape-to-close for free.
 *
 * We add: scroll locking, a labelled title, restore-focus on close, and a
 * confirmation variant for destructive actions (which the spec requires).
 */

import * as React from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Bottom sheet on mobile, centred card from `sm` up. */
  mobileSheet?: boolean;
  className?: string;
}

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  mobileSheet = true,
  className,
}: DialogProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const previouslyFocused = React.useRef<HTMLElement | null>(null);

  // Keep the native element in sync with the React `open` prop.
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      // Lock background scroll; without this, iOS scrolls the page behind.
      document.body.style.overflow = 'hidden';
    } else if (!open && dialog.open) {
      dialog.close();
      document.body.style.overflow = '';
      previouslyFocused.current?.focus?.();
    }
  }, [open]);

  React.useEffect(() => {
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Fires when the user closes via Escape or the backdrop.
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop closes; clicking the panel does not.
        if (event.target === dialogRef.current) onClose();
      }}
      className={cn(
        'w-full bg-transparent p-0 backdrop:bg-ink/45 backdrop:backdrop-blur-[2px]',
        'sm:mx-auto sm:my-auto sm:max-h-[90vh]',
        mobileSheet
          ? 'mt-auto mb-0 max-h-[92vh] sm:m-auto'
          : 'm-auto max-h-[92vh]',
      )}
    >
      <div
        className={cn(
          'flex max-h-[92vh] w-full flex-col overflow-hidden border border-line bg-paper shadow-book-lg',
          mobileSheet ? 'rounded-t-2xl sm:rounded-2xl' : 'rounded-2xl',
          SIZES[size],
          'sm:w-auto sm:min-w-[min(100%-2rem,24rem)]',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-ink-muted">
                {description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 h-9 w-9 shrink-0 rounded-full text-ink-muted transition-colors hover:bg-paper-soft hover:text-ink"
          >
            <svg className="mx-auto h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 pb-safe">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  /** Extra controls rendered under the description, e.g. a reason field. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** Require the user to type this exact string — for irreversible actions. */
  confirmationPhrase?: string;
  loading?: boolean;
}

/**
 * Confirmation dialog for destructive or irreversible actions.
 *
 * The typed-phrase variant exists for account deletion and refunds, where a
 * mis-click costs real money or destroys data that cannot be recovered.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  confirmationPhrase,
  children,
  loading,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState('');
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const phraseOk = !confirmationPhrase || typed.trim() === confirmationPhrase;
  const busy = loading || working;

  const handleConfirm = async () => {
    if (!phraseOk || busy) return;
    setWorking(true);
    try {
      await onConfirm();
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            disabled={!phraseOk || busy}
            loading={busy}
            loadingLabel="Working"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <p className="text-sm leading-relaxed text-ink-soft">{description}</p>}

      {children}

      {confirmationPhrase && (
        <div className="mt-4">
          <label htmlFor="confirm-phrase" className="mb-1.5 block text-sm font-medium text-ink">
            Type <span className="font-mono font-bold">{confirmationPhrase}</span> to confirm
          </label>
          <input
            id="confirm-phrase"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            className="w-full rounded-xl border border-line bg-paper px-3.5 py-3 font-mono text-base tracking-wider text-ink focus:border-ink focus:outline-none"
          />
        </div>
      )}
    </Dialog>
  );
}
