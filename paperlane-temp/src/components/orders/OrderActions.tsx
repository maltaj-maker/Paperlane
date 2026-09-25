'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { cancelOrderAction, requestReturnAction } from '@/app/actions/orders';
import { IDLE } from '@/app/actions/types';
import { Alert } from '@/components/ui/Feedback';
import { Textarea } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';

/**
 * Customer-side order actions: cancel and request a return.
 *
 * Both sit behind a confirmation dialog, both explain the consequence before the
 * customer commits, and both are re-checked on the server — the UI's opinion of
 * whether cancelling is allowed is a convenience, not a control.
 *
 * Cancelling asks *why*, optionally. It costs one field and it is the single
 * best source of honest feedback a small shop gets.
 */
export function OrderActions({
  orderId,
  orderNumber,
  canCancel,
  cancelReason,
  canReturn,
}: {
  orderId: string;
  orderNumber: string;
  canCancel: boolean;
  cancelReason?: string;
  canReturn: boolean;
}) {
  const [confirming, setConfirming] = useState<'cancel' | 'return' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const run = (kind: 'cancel' | 'return') => {
    setError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set('orderId', orderId);
      formData.set('reason', reason);

      const result =
        kind === 'cancel'
          ? await cancelOrderAction(IDLE, formData)
          : await requestReturnAction(IDLE, formData);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setConfirming(null);
      setReason('');
      toast.success(
        kind === 'cancel' ? 'Order cancelled' : 'Return requested',
        result.message ?? undefined,
      );
      router.refresh();
    });
  };

  if (!canCancel && !canReturn) return null;

  return (
    <section className="mt-8 border-t border-line pt-6" aria-labelledby="actions-heading">
      <h2 id="actions-heading" className="font-display text-lg font-semibold text-ink">
        Need to change something?
      </h2>

      <div className="mt-3 flex flex-wrap gap-3">
        {canCancel && (
          <button
            type="button"
            onClick={() => setConfirming('cancel')}
            className="min-h-[44px] rounded-full border border-line px-5 text-sm font-medium text-ink transition-colors hover:border-danger hover:text-danger"
          >
            Cancel this order
          </button>
        )}

        {canReturn && (
          <button
            type="button"
            onClick={() => setConfirming('return')}
            className="min-h-[44px] rounded-full border border-line px-5 text-sm font-medium text-ink transition-colors hover:border-ink-faint"
          >
            Request a return
          </button>
        )}

        <Link
          href={`/contact?order=${orderNumber}`}
          className="inline-flex min-h-[44px] items-center rounded-full px-5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
        >
          Ask a question instead
        </Link>
      </div>

      {!canCancel && cancelReason && (
        <p className="mt-3 text-xs text-ink-muted">{cancelReason}</p>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => {
          setConfirming(null);
          setError(null);
        }}
        onConfirm={() => run(confirming ?? 'cancel')}
        title={confirming === 'return' ? 'Request a return?' : 'Cancel this order?'}
        confirmLabel={confirming === 'return' ? 'Request return' : 'Yes, cancel it'}
        cancelLabel="Keep my order"
        tone={confirming === 'return' ? 'default' : 'danger'}
        loading={pending}
        description={
          confirming === 'return' ? (
            <>
              We will email you a return label and the steps to send the book back. Refunds are issued to
              the original payment method once the book reaches us.
            </>
          ) : (
            <>
              Order {orderNumber} will be cancelled and any stock released. If you have already paid, the
              refund goes back to your original payment method — usually within 5–7 working days.
            </>
          )
        }
      >
        {error && (
          <Alert tone="danger" className="mt-4" live="assertive">
            {error}
          </Alert>
        )}

        <Textarea
          label={confirming === 'return' ? 'What went wrong?' : 'Anything you would like to tell us?'}
          name="reason"
          id="reason"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint="Optional"
          wrapClassName="mt-4"
        />
      </ConfirmDialog>
    </section>
  );
}
