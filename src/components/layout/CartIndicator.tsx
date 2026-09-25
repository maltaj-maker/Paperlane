import Link from 'next/link';

/**
 * Cart icon with a live item count.
 *
 * The count is server-rendered, so it is correct on first paint (no badge that
 * pops in late). It has an accessible label that includes the number, because
 * "Bag" alone tells a screen-reader user nothing about whether their items are
 * actually in there.
 */
export function CartIndicator({ count }: { count: number }) {
  return (
    <Link
      href="/cart"
      aria-label={count > 0 ? `Basket, ${count} ${count === 1 ? 'item' : 'items'}` : 'Basket, empty'}
      title="Basket"
      className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4.5 8h15l-1.2 11.2a1.8 1.8 0 01-1.8 1.6H7.5a1.8 1.8 0 01-1.8-1.6L4.5 8z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M9 8V6.5a3 3 0 016 0V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>

      {count > 0 && (
        <span className="absolute right-1 top-1 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-accent px-1 py-0.5 text-[10px] font-bold leading-none text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
