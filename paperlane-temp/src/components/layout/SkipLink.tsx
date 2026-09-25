/**
 * Skip link.
 *
 * First focusable element on every page. Without it, a keyboard or screen-reader
 * user must tab through the entire header — logo, search, eight nav items, cart —
 * before reaching the content, on every single page.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only-focusable fixed left-4 top-4 z-[100] rounded-full bg-brand-700 px-4 py-3 text-sm font-semibold text-paper shadow-book-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent"
    >
      Skip to main content
    </a>
  );
}
