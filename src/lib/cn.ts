/**
 * Tiny class-name joiner.
 *
 * Deliberately not `clsx` + `tailwind-merge`: those two libraries add ~9KB to
 * the client bundle for behaviour we can get from a 12-line function. The one
 * nuance that matters — a later `className` winning over an earlier conditional
 * one — is handled by simply listing classes in priority order.
 */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | Record<string, boolean | null | undefined>
  | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value && value !== 0) return;

    if (typeof value === 'string' || typeof value === 'number') {
      out.push(String(value));
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value === 'object') {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled) out.push(key);
      }
    }
  };

  walk(inputs);
  return out.join(' ');
}

/** Format a number with Indian digit grouping. */
export function formatNumber(value: number, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Compact count for badges: 1200 -> "1.2k". */
export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 100_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(value / 100_000).toFixed(1).replace(/\.0$/, '')}L`;
}

/** Relative time for order timelines and reviews. */
export function timeAgo(date: Date | string | number): string {
  const then = new Date(date).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.round(months / 12);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/** Absolute date in the store's locale, e.g. "14 Mar 2025". */
export function formatDate(date: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!date) return '—';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  }).format(parsed);
}

/** Date and time, for admin tables and audit trails. */
export function formatDateTime(date: Date | string | number | null | undefined): string {
  if (!date) return '—';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

/** Long-form date for delivery estimates: "Friday, 3 October". */
export function formatDeliveryDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parsed);
}

/** A delivery window: "3–6 Oct" or "28 Sep – 2 Oct". */
export function formatDeliveryWindow(from: Date | string, to: Date | string): string {
  const a = new Date(from);
  const b = new Date(to);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

  const dayA = new Intl.DateTimeFormat('en-IN', { day: 'numeric' }).format(a);
  const dayB = new Intl.DateTimeFormat('en-IN', { day: 'numeric' }).format(b);
  const monthA = new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(a);
  const monthB = new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(b);

  return sameMonth ? `${dayA}–${dayB} ${monthA}` : `${dayA} ${monthA} – ${dayB} ${monthB}`;
}

/** Truncate a string at a word boundary. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Pluralise simply: pluralise(2, 'book') -> "2 books". */
export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
