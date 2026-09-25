/**
 * Text utilities for search, slugs and metadata.
 *
 * Search quality on a bookstore lives or dies on normalisation: "The Palace of
 * Illusions", "palace illusions" and "palace of illusion" should all find the
 * same book. Everything funnels through `normaliseForSearch` so the index side
 * and the query side can never drift.
 */

/** Lowercase, strip accents, collapse punctuation and whitespace. */
export function normaliseForSearch(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/['’`]/g, '') // don't -> dont
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words that carry no signal in a book search. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from',
  'is', 'it', 'its', 'as', 'that', 'this', 'be', 'are', 'was', 'were', 'de', 'la', 'le', 'el',
]);

export function tokenise(input: string): string[] {
  return normaliseForSearch(input)
    .split(' ')
    .filter((token) => token.length > 0);
}

/** Drop stop words, but never return an empty list (fall back to raw tokens). */
export function significantTokens(input: string): string[] {
  const tokens = tokenise(input);
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t) && t.length > 1);
  return filtered.length > 0 ? filtered : tokens;
}

/**
 * Damerau-ish Levenshtein distance, capped for speed.
 *
 * Only used for typo recovery against a small candidate vocabulary (title words,
 * author surnames), never against the whole table — that would be O(n·m) per
 * keystroke. Bounded by `maxDistance` so it early-exits.
 */
export function levenshtein(a: string, b: string, maxDistance = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      );
      // Transposition ("hte" -> "the")
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j]!, prev[j - 2]! + 1);
      }
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }

    if (rowMin > maxDistance) return maxDistance + 1;
    [prev, curr] = [curr, prev];
  }

  return prev[b.length]!;
}

/** How forgiving to be, based on how much the user typed. */
export function typoBudget(term: string): number {
  if (term.length <= 3) return 0; // 'ita' should not match 'the'
  if (term.length <= 5) return 1;
  return 2;
}

/** URL-safe slug. Handles Unicode by transliterating what it can. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'item';
}

/** Ensure a slug is unique by appending -2, -3, ... as needed. */
export function dedupeSlug(slug: string, taken: Set<string>): string {
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

/** Truncate on a word boundary, appending an ellipsis. */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  const cut = input.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Escape a string for safe inclusion in a regular expression. */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highlight matched terms with a marker, for autocomplete display. */
export function highlightMatches(text: string, terms: string[], open = '\u0001', close = '\u0002'): string {
  if (terms.length === 0) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return text.replace(pattern, `${open}$1${close}`);
}

/** Estimated reading time for blog posts, at ~200 wpm. */
export function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

/** Plain-text excerpt from markdown-ish content. */
export function toExcerpt(body: string, length = 160): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(plain, length);
}

/**
 * Validate an Indian PIN code. First digit 1-9, exactly six digits.
 * Used for delivery estimates; not a substitute for carrier-side validation.
 */
export function isValidIndianPostalCode(value: string): boolean {
  return /^[1-9][0-9]{5}$/.test(value.trim());
}

/**
 * Validate an ISBN-10 or ISBN-13, including its check digit.
 * A wrong check digit means a typo, and searching for a typo is a support ticket.
 */
export function isValidIsbn(raw: string): { valid: boolean; type: 'isbn10' | 'isbn13' | null; normalised: string } {
  const normalised = raw.replace(/[^0-9Xx]/g, '').toUpperCase();

  if (normalised.length === 10) {
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      const digit = Number(normalised[i]);
      if (Number.isNaN(digit)) return { valid: false, type: null, normalised };
      sum += digit * (10 - i);
    }
    const last = normalised[9];
    const check = last === 'X' ? 10 : Number(last);
    if (Number.isNaN(check)) return { valid: false, type: null, normalised };
    sum += check;
    return { valid: sum % 11 === 0, type: 'isbn10', normalised };
  }

  if (normalised.length === 13) {
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      const digit = Number(normalised[i]);
      if (Number.isNaN(digit)) return { valid: false, type: null, normalised };
      sum += i % 2 === 0 ? digit : digit * 3;
    }
    return { valid: sum % 10 === 0, type: 'isbn13', normalised };
  }

  return { valid: false, type: null, normalised };
}

/** Convert ISBN-10 to ISBN-13 (the format most catalogues and barcodes use). */
export function isbn10To13(isbn10: string): string | null {
  const digits = isbn10.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (digits.length !== 10) return null;
  const core = `978${digits.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(core[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${core}${check}`;
}

/** Is this search string plausibly an ISBN? Drives the "ISBN lookup" path. */
export function looksLikeIsbn(query: string): boolean {
  const digits = query.replace(/[^0-9Xx]/g, '');
  return digits.length >= 10 && digits.length <= 13 && /^[0-9Xx\s-]+$/.test(query.trim());
}

/**
 * Split a name into given/family parts. Imperfect for Indian naming conventions
 * where the family name often precedes the given name; used only for display
 * and author-page sorting, never for identity.
 */
export function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

/** Initials for avatar fallbacks: "Arundhati Roy" -> "AR". */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
