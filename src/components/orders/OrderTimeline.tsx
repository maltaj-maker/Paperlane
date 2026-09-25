import { formatDateTime } from '@/lib/cn';
import { cn } from '@/lib/cn';
import { ORDER_STATUS, PAYMENT_STATUS, FULFILLMENT_STATUS } from '@/lib/constants';

/**
 * Order progress.
 *
 * Steps are driven by real columns, not by optimistic inference. A step that has
 * not happened yet is shown as upcoming with no timestamp — never with an
 * invented "expected" date, which is the fastest way to a support ticket when it
 * slips.
 */
export function OrderTimeline({
  status,
  paymentStatus,
  fulfillmentStatus,
  placedAt,
  confirmedAt,
  shippedAt,
  deliveredAt,
  cancelledAt,
}: {
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  placedAt: Date;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
}) {
  const cancelled = status === ORDER_STATUS.CANCELLED;
  const paid = paymentStatus === PAYMENT_STATUS.PAID || paymentStatus === PAYMENT_STATUS.PARTIALLY_REFUNDED;

  const steps = [
    { label: 'Order placed', at: placedAt, done: true },
    {
      label: paid ? 'Payment confirmed' : 'Awaiting payment',
      at: paid ? confirmedAt : null,
      done: paid,
    },
    {
      label: 'Packed and shipped',
      at: shippedAt,
      done: fulfillmentStatus === FULFILLMENT_STATUS.SHIPPED || fulfillmentStatus === FULFILLMENT_STATUS.DELIVERED,
    },
    {
      label: 'Delivered',
      at: deliveredAt,
      done: fulfillmentStatus === FULFILLMENT_STATUS.DELIVERED,
    },
  ];

  return (
    <ol className="mt-4 space-y-0">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;

        return (
          <li key={step.label} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                  step.done
                    ? 'border-success bg-success text-paper'
                    : 'border-line bg-paper text-ink-faint',
                )}
                aria-hidden="true"
              >
                {step.done ? (
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6.2l2.3 2.3L9.5 3.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </span>

              {!isLast && <span className={cn('w-0.5 flex-1', step.done ? 'bg-success/40' : 'bg-line')} />}
            </div>

            <div className={cn('min-w-0 pb-6', isLast && 'pb-0')}>
              <p className={cn('text-sm font-medium', step.done ? 'text-ink' : 'text-ink-muted')}>
                {step.label}
                <span className="sr-only">{step.done ? ' — completed' : ' — not yet'}</span>
              </p>
              {step.at && <p className="mt-0.5 text-xs text-ink-faint">{formatDateTime(step.at)}</p>}
            </div>
          </li>
        );
      })}

      {cancelled && cancelledAt && (
        <li className="flex gap-4">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-danger bg-paper text-danger"
            aria-hidden="true"
          >
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-medium text-danger">Order cancelled</p>
            <p className="mt-0.5 text-xs text-ink-faint">{formatDateTime(cancelledAt)}</p>
          </div>
        </li>
      )}
    </ol>
  );
}
