/**
 * Input validation.
 *
 * Every value that crosses a trust boundary is parsed here: request bodies,
 * form submissions, query parameters, CSV import rows. Nothing reaches the
 * database without passing through a schema in this file.
 *
 * Two rules this file exists to enforce:
 *  - **Never trust client-side validation.** The browser form is a convenience;
 *    these schemas are the control.
 *  - **Never accept a price, total, stock count or role from the client.**
 *    Those fields simply do not exist in the input schemas below, which makes it
 *    structurally impossible for a crafted request to set them.
 */

import { z } from 'zod';
import { isValidIndianPostalCode, isValidIsbn } from './text';
import { BOOK_FORMAT, COUPON_TYPE } from './constants';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const trimmed = z.string().trim();

/** Password policy: length first, composition second. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters — longer passwords are stronger than complicated ones.')
  .max(200, 'That password is too long.')
  .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter.')
  .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter.')
  .refine((v) => /[0-9]/.test(v), 'Include at least one number.')
  .refine(
    (v) => !['password12', 'Password123', 'qwerty12345', '1234567890'].includes(v),
    'That password is too common. Please choose another.',
  );

export const emailSchema = trimmed
  .min(3, 'Enter your email address.')
  .max(254, 'That email address is too long.')
  .email('That does not look like an email address.')
  .transform((v) => v.toLowerCase());

/**
 * Indian mobile numbers, accepting the shapes people actually type:
 * +91 98765 43210, 098765-43210, 9876543210.
 */
export const phoneSchema = trimmed
  .min(6, 'Enter a phone number.')
  .max(20, 'That phone number is too long.')
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .refine((v) => /^(\+?\d{1,3})?\d{6,12}$/.test(v), 'Enter a valid phone number.')
  .transform((v) => (v.startsWith('+') ? v : v.length === 10 ? `+91${v}` : v));

export const postalCodeSchema = trimmed.refine(
  (v) => isValidIndianPostalCode(v) || /^[A-Za-z0-9][A-Za-z0-9\s-]{2,9}$/.test(v),
  'Enter a valid postal code.',
);

export const isbnSchema = trimmed
  .transform((v) => v.replace(/[^0-9Xx]/g, '').toUpperCase())
  .refine((v) => v.length === 0 || isValidIsbn(v).valid, 'That ISBN check digit does not add up — please re-check it.');

/** Reject strings that are only punctuation/whitespace, or contain control chars. */
function cleanText(min: number, max: number, label: string) {
  return trimmed
    .min(min, `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be under ${max} characters.`)
    // eslint-disable-next-line no-control-regex
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v), `${label} contains invalid characters.`)
    .refine((v) => /[a-zA-Z0-9\u0900-\u097F]/.test(v), `${label} needs at least one letter or number.`);
}

export const slugSchema = trimmed
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slugs may contain lowercase letters, numbers and hyphens only.');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  name: cleanText(2, 80, 'Name'),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional().or(z.literal('').transform(() => undefined)),
  marketingEmailConsent: z.coerce.boolean().default(false),
  /** Honeypot: bots fill hidden fields, humans do not. */
  website: z.string().max(0, 'Something went wrong. Please try again.').optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(200),
  rememberMe: z.coerce.boolean().default(true),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10, 'That reset link is not valid.'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Those passwords do not match.',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Those passwords do not match.',
    path: ['confirmPassword'],
  });

export const verifyEmailSchema = z.object({ token: z.string().min(10) });

export const updateProfileSchema = z.object({
  name: cleanText(2, 80, 'Name'),
  phone: phoneSchema.optional().or(z.literal('').transform(() => undefined)),
  avatarUrl: z.string().url().max(500).optional().or(z.literal('').transform(() => undefined)),
});

export const notificationPrefsSchema = z.object({
  orderUpdates: z.coerce.boolean().default(true),
  backInStock: z.coerce.boolean().default(true),
  priceDrop: z.coerce.boolean().default(false),
  newsletter: z.coerce.boolean().default(false),
  marketingSmsConsent: z.coerce.boolean().default(false),
  marketingWhatsappConsent: z.coerce.boolean().default(false),
});

export const readingPrefsSchema = z.object({
  favouriteGenres: z.array(z.string().min(1)).max(20).default([]),
  preferredFormats: z.array(z.enum(Object.values(BOOK_FORMAT) as [string, ...string[]])).max(4).default([]),
  preferredLanguages: z.array(z.string().max(40)).max(10).default([]),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm.'),
  /** Typed confirmation, because this cannot be undone. */
  confirm: z.literal('DELETE', {
    errorMap: () => ({ message: 'Type DELETE to confirm.' }),
  }),
  reason: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export const addressSchema = z.object({
  label: trimmed.max(40).default('Home'),
  fullName: cleanText(2, 80, 'Full name'),
  phone: phoneSchema,
  line1: cleanText(4, 160, 'Address'),
  line2: trimmed.max(160).optional().or(z.literal('').transform(() => undefined)),
  city: cleanText(2, 60, 'City'),
  state: cleanText(2, 60, 'State'),
  postalCode: postalCodeSchema,
  country: trimmed.length(2).default('IN'),
  isDefaultShipping: z.coerce.boolean().default(false),
  isDefaultBilling: z.coerce.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressSchema>;

// ---------------------------------------------------------------------------
// Cart & checkout
// ---------------------------------------------------------------------------

export const addToCartSchema = z.object({
  bookId: z.string().min(1, 'Choose a book.'),
  quantity: z.coerce.number().int().min(1).max(10).default(1),
  /**
   * The price shown in the UI. Used *only* to detect drift and show a friendly
   * "the price changed" notice. It is never used to compute what is charged.
   */
  expectedUnitPricePaise: z.coerce.number().int().nonnegative().optional(),
});

export const updateCartItemSchema = z.object({
  cartItemId: z.string().min(1),
  quantity: z.coerce.number().int().min(0).max(10),
});

export const applyCouponSchema = z.object({
  code: trimmed.min(1, 'Enter a coupon code.').max(40).transform((v) => v.toUpperCase()),
});

export const checkoutSchema = z.object({
  /**
   * The anti-duplicate key. Generated client-side per checkout attempt and
   * unique-indexed server-side, so a double submit cannot create two orders.
   */
  idempotencyKey: z.string().min(8).max(80),

  email: emailSchema,
  phone: phoneSchema,
  customerName: cleanText(2, 80, 'Name'),

  shippingAddress: addressSchema,
  /** When absent, the shipping address is used. */
  billingAddress: addressSchema.optional(),
  billingSameAsShipping: z.coerce.boolean().default(true),

  shippingMethodId: z.string().optional().nullable(),
  /** Payment method *family*. Never a card number. */
  paymentMethod: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD']),
  currency: z.string().length(3).transform((v) => v.toUpperCase()),
  couponCode: trimmed.max(40).optional().nullable(),
  giftCardCode: trimmed.max(40).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  acceptTerms: z.coerce.boolean().refine((v) => v === true, 'Please accept the terms to place your order.'),

  /** Honeypot for automated checkout abuse. */
  website: z.string().max(0).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const reviewSchema = z.object({
  bookId: z.string().min(1),
  rating: z.coerce
    .number()
    .int()
    .min(1, 'Choose a rating from 1 to 5 stars.')
    .max(5, 'Ratings run from 1 to 5 stars.'),
  title: trimmed.max(120, 'Keep the headline under 120 characters.').optional().or(z.literal('').transform(() => undefined)),
  body: cleanText(20, 4000, 'Review'),
  /** Honeypot. */
  website: z.string().max(0).optional(),
});

export const reviewReportSchema = z.object({
  reviewId: z.string().min(1),
  reason: z.enum(['spam', 'abuse', 'spoiler', 'irrelevant', 'other']),
  detail: trimmed.max(500).optional(),
});

export const reviewModerationSchema = z.object({
  reviewId: z.string().min(1),
  status: z.enum(['pending', 'approved', 'rejected', 'hidden']),
  note: trimmed.max(500).optional(),
});

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export const supportTicketSchema = z.object({
  name: cleanText(2, 80, 'Name'),
  email: emailSchema,
  orderNumber: trimmed.max(40).optional().or(z.literal('').transform(() => undefined)),
  category: z.enum(['order_status', 'delivery', 'refund', 'product', 'account', 'other']),
  subject: cleanText(4, 150, 'Subject'),
  message: cleanText(20, 4000, 'Message'),
  website: z.string().max(0).optional(),
});

export const supportReplySchema = z.object({
  ticketId: z.string().min(1),
  body: cleanText(1, 4000, 'Reply'),
  isInternal: z.coerce.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Newsletter
// ---------------------------------------------------------------------------

export const newsletterSchema = z.object({
  email: emailSchema,
  name: trimmed.max(80).optional(),
  source: trimmed.max(60).optional(),
  consent: z.coerce.boolean().refine((v) => v === true, 'Please tick the box to subscribe.'),
  website: z.string().max(0).optional(),
});

// ---------------------------------------------------------------------------
// Wishlist / stock alerts
// ---------------------------------------------------------------------------

export const wishlistSchema = z.object({ bookId: z.string().min(1) });

export const stockAlertSchema = z.object({
  email: emailSchema,
  bookId: z.string().min(1),
  /** Distinguishes restock alerts from price-drop alerts. */
  kind: z.enum(['back_in_stock', 'price_drop']).default('back_in_stock'),
});

// ---------------------------------------------------------------------------
// Admin — books
// ---------------------------------------------------------------------------

const paiseSchema = z.coerce
  .number()
  .int('Amounts are stored in paise; use a whole number.')
  .nonnegative('Price cannot be negative.')
  .max(100_000_000, 'That price looks wrong.');

export const bookWriteSchema = z
  .object({
    title: cleanText(1, 250, 'Title'),
    subtitle: trimmed.max(250).optional().or(z.literal('').transform(() => undefined)),
    slug: slugSchema.optional(),
    authorId: z.string().min(1, 'Choose an author.'),
    publisherId: z.string().optional().nullable(),
    genreId: z.string().optional().nullable(),
    additionalGenreIds: z.array(z.string()).max(6).default([]),

    isbn13: isbnSchema.optional().or(z.literal('').transform(() => undefined)),
    isbn10: isbnSchema.optional().or(z.literal('').transform(() => undefined)),
    edition: trimmed.max(60).optional().or(z.literal('').transform(() => undefined)),
    language: trimmed.max(40).default('English'),
    format: z.enum(Object.values(BOOK_FORMAT) as [string, ...string[]]).default('paperback'),

    description: cleanText(20, 20_000, 'Description'),
    synopsis: trimmed.max(4_000).optional().or(z.literal('').transform(() => undefined)),

    publicationDate: z.coerce.date().optional().nullable(),
    pageCount: z.coerce.number().int().positive().max(20_000).optional().nullable(),
    dimensions: trimmed.max(60).optional().or(z.literal('').transform(() => undefined)),
    weightGrams: z.coerce.number().int().positive().max(20_000).optional().nullable(),
    ageRangeMin: z.coerce.number().int().min(0).max(99).optional().nullable(),
    ageRangeMax: z.coerce.number().int().min(0).max(99).optional().nullable(),

    coverImageUrl: z.string().min(1, 'A cover image is required.').max(600),
    coverAlt: trimmed.max(200).optional().or(z.literal('').transform(() => undefined)),

    currency: trimmed.length(3).default('INR'),
    pricePaise: paiseSchema,
    salePricePaise: paiseSchema.optional().nullable(),
    taxCategory: trimmed.max(60).default('books_print'),
    taxInclusive: z.coerce.boolean().default(true),

    status: z.enum(['draft', 'active', 'archived']).default('draft'),
    isFeatured: z.coerce.boolean().default(false),
    isStaffPick: z.coerce.boolean().default(false),
    isNewRelease: z.coerce.boolean().default(false),
    isTrending: z.coerce.boolean().default(false),
    publishedAt: z.coerce.date().optional().nullable(),

    metaTitle: trimmed.max(70).optional().or(z.literal('').transform(() => undefined)),
    metaDescription: trimmed.max(180).optional().or(z.literal('').transform(() => undefined)),
    seoKeywords: trimmed.max(300).optional().or(z.literal('').transform(() => undefined)),
  })
  .refine(
    (data) => data.salePricePaise === null || data.salePricePaise === undefined || data.salePricePaise < data.pricePaise,
    { message: 'Sale price must be lower than the list price.', path: ['salePricePaise'] },
  )
  .refine(
    (data) =>
      data.ageRangeMin === null ||
      data.ageRangeMax === null ||
      data.ageRangeMin === undefined ||
      data.ageRangeMax === undefined ||
      data.ageRangeMin <= data.ageRangeMax,
    { message: 'Minimum age cannot exceed maximum age.', path: ['ageRangeMax'] },
  );
export type BookWriteInput = z.infer<typeof bookWriteSchema>;

export const authorWriteSchema = z.object({
  name: cleanText(2, 120, 'Author name'),
  slug: slugSchema.optional(),
  bio: trimmed.max(4_000).optional().or(z.literal('').transform(() => undefined)),
  photoUrl: z.string().url().max(500).optional().or(z.literal('').transform(() => undefined)),
  nationality: trimmed.max(60).optional().or(z.literal('').transform(() => undefined)),
  birthYear: z.coerce.number().int().min(1000).max(new Date().getFullYear()).optional().nullable(),
  website: z.string().url().max(300).optional().or(z.literal('').transform(() => undefined)),
  isFeatured: z.coerce.boolean().default(false),
});

export const publisherWriteSchema = z.object({
  name: cleanText(2, 150, 'Publisher name'),
  slug: slugSchema.optional(),
  description: trimmed.max(2_000).optional().or(z.literal('').transform(() => undefined)),
  logoUrl: z.string().url().max(500).optional().or(z.literal('').transform(() => undefined)),
  website: z.string().url().max(300).optional().or(z.literal('').transform(() => undefined)),
});

export const genreWriteSchema = z.object({
  name: cleanText(2, 80, 'Genre name'),
  slug: slugSchema.optional(),
  description: trimmed.max(1_500).optional().or(z.literal('').transform(() => undefined)),
  parentId: z.string().optional().nullable(),
  heroImage: z.string().url().max(500).optional().or(z.literal('').transform(() => undefined)),
  isFeatured: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(9_999).default(0),
});

// ---------------------------------------------------------------------------
// Admin — inventory
// ---------------------------------------------------------------------------

export const stockAdjustSchema = z.object({
  inventoryItemId: z.string().min(1),
  /** Signed. Positive adds stock, negative removes. */
  delta: z.coerce
    .number()
    .int()
    .refine((v) => v !== 0, 'Enter a non-zero adjustment.')
    .refine((v) => Math.abs(v) <= 100_000, 'That adjustment is implausibly large.'),
  type: z.enum(['adjust', 'receive', 'damage', 'loss']),
  reason: cleanText(5, 300, 'Reason'),
});

export const stockReceiveSchema = z.object({
  inventoryItemId: z.string().min(1),
  quantity: z.coerce.number().int().positive().max(100_000),
  reason: cleanText(3, 300, 'Reason').default('Stock received from distributor'),
});

export const inventoryWriteSchema = z.object({
  bookId: z.string().min(1),
  warehouseId: z.string().min(1),
  sku: trimmed.min(1).max(60),
  shelf: trimmed.max(30).optional().or(z.literal('').transform(() => undefined)),
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).default(5),
  costPaise: paiseSchema.optional().nullable(),
});

// ---------------------------------------------------------------------------
// Admin — promotions
// ---------------------------------------------------------------------------

export const couponWriteSchema = z
  .object({
    code: trimmed
      .min(3, 'Codes must be at least 3 characters.')
      .max(40)
      .transform((v) => v.toUpperCase())
      .refine((v) => /^[A-Z0-9_-]+$/.test(v), 'Use letters, numbers, hyphens and underscores only.'),
    description: trimmed.max(200).optional().or(z.literal('').transform(() => undefined)),
    type: z.enum(Object.values(COUPON_TYPE) as [string, ...string[]]),
    valuePercent: z.coerce.number().min(0.01).max(100).optional().nullable(),
    valuePaise: paiseSchema.optional().nullable(),
    minOrderPaise: paiseSchema.default(0),
    maxDiscountPaise: paiseSchema.optional().nullable(),
    scope: z.enum(['all', 'books', 'genres', 'first_order']).default('all'),
    appliesToBookIds: z.array(z.string()).max(500).default([]),
    appliesToGenreIds: z.array(z.string()).max(100).default([]),
    firstOrderOnly: z.coerce.boolean().default(false),
    startsAt: z.coerce.date().optional().nullable(),
    endsAt: z.coerce.date().optional().nullable(),
    usageLimit: z.coerce.number().int().positive().max(1_000_000).optional().nullable(),
    perCustomerLimit: z.coerce.number().int().positive().max(1_000).optional().nullable(),
    isAutomatic: z.coerce.boolean().default(false),
    isActive: z.coerce.boolean().default(true),
  })
  .refine((d) => (d.type === 'percent' ? (d.valuePercent ?? 0) > 0 : d.type === 'fixed' ? (d.valuePaise ?? 0) > 0 : true), {
    message: 'Enter a discount value.',
    path: ['valuePercent'],
  })
  .refine((d) => !d.startsAt || !d.endsAt || d.startsAt < d.endsAt, {
    message: 'The end date must be after the start date.',
    path: ['endsAt'],
  })
  .refine((d) => d.scope !== 'books' || d.appliesToBookIds.length > 0, {
    message: 'Select at least one book.',
    path: ['appliesToBookIds'],
  })
  .refine((d) => d.scope !== 'genres' || d.appliesToGenreIds.length > 0, {
    message: 'Select at least one genre.',
    path: ['appliesToGenreIds'],
  });

// ---------------------------------------------------------------------------
// Admin — orders
// ---------------------------------------------------------------------------

export const orderFulfilmentSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(['processing', 'packed', 'shipped', 'delivered', 'returned']),
  note: trimmed.max(500).optional().nullable(),
  carrier: trimmed.max(60).optional(),
  trackingNumber: trimmed.max(80).optional(),
  trackingUrl: z.string().url().max(500).optional().or(z.literal('').transform(() => undefined)),
  estimatedDelivery: z.coerce.date().optional().nullable(),
});

export const refundSchema = z.object({
  orderId: z.string().min(1),
  kind: z.enum(['full', 'partial']),
  amountPaise: paiseSchema.default(0),
  reason: cleanText(3, 500, 'Reason'),
  restock: z.coerce.boolean().default(true),
  notes: trimmed.max(500).optional().nullable(),
});

export const cancelOrderSchema = z.object({
  orderId: z.string().min(1),
  reason: cleanText(3, 300, 'Reason'),
  restock: z.coerce.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Admin — content
// ---------------------------------------------------------------------------

export const bannerWriteSchema = z.object({
  key: slugSchema.optional(),
  title: cleanText(2, 150, 'Title'),
  subtitle: trimmed.max(200).optional().or(z.literal('').transform(() => undefined)),
  body: trimmed.max(1_000).optional().or(z.literal('').transform(() => undefined)),
  imageUrl: z.string().max(500).optional().or(z.literal('').transform(() => undefined)),
  ctaLabel: trimmed.max(40).optional().or(z.literal('').transform(() => undefined)),
  ctaHref: trimmed.max(300).optional().or(z.literal('').transform(() => undefined)),
  placement: z.enum(['home_hero', 'home_strip', 'instagram_cta', 'announcement', 'checkout']),
  theme: trimmed.max(30).optional().or(z.literal('').transform(() => undefined)),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  startsAt: z.coerce.date().optional().nullable(),
  endsAt: z.coerce.date().optional().nullable(),
  isActive: z.coerce.boolean().default(true),
});

export const blogPostSchema = z.object({
  title: cleanText(4, 200, 'Title'),
  slug: slugSchema.optional(),
  excerpt: trimmed.max(400).optional().or(z.literal('').transform(() => undefined)),
  body: cleanText(50, 100_000, 'Body'),
  coverImage: z.string().max(500).optional().or(z.literal('').transform(() => undefined)),
  category: z.enum(['book_review', 'reading_guide', 'trope_guide', 'author_interview', 'recommendation', 'news']),
  tags: z.array(trimmed.max(40)).max(12).default([]),
  status: z.enum(['draft', 'scheduled', 'published', 'archived']).default('draft'),
  publishedAt: z.coerce.date().optional().nullable(),
  authorName: trimmed.max(80).optional().or(z.literal('').transform(() => undefined)),
  metaTitle: trimmed.max(70).optional().or(z.literal('').transform(() => undefined)),
  metaDescription: trimmed.max(180).optional().or(z.literal('').transform(() => undefined)),
});

export const faqWriteSchema = z.object({
  question: cleanText(5, 250, 'Question'),
  answer: cleanText(5, 4_000, 'Answer'),
  category: trimmed.max(40).default('general'),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.coerce.boolean().default(true),
});

export const settingWriteSchema = z.object({
  key: trimmed.min(1).max(80),
  value: z.string().max(4_000),
});

// ---------------------------------------------------------------------------
// Search / query params
// ---------------------------------------------------------------------------

export const searchQuerySchema = z.object({
  q: trimmed.max(200).optional(),
  sort: z
    .enum(['relevance', 'popularity', 'newest', 'price_asc', 'price_desc', 'rating', 'discount'])
    .default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
  genre: z.union([z.string(), z.array(z.string())]).optional(),
  author: z.union([z.string(), z.array(z.string())]).optional(),
  publisher: z.union([z.string(), z.array(z.string())]).optional(),
  language: z.union([z.string(), z.array(z.string())]).optional(),
  format: z.union([z.string(), z.array(z.string())]).optional(),
  minPrice: z.coerce.number().min(0).max(1_000_000).optional(),
  maxPrice: z.coerce.number().min(0).max(1_000_000).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  inStock: z.coerce.boolean().optional(),
  onSale: z.coerce.boolean().optional(),
  isbn: trimmed.max(20).optional(),
});

/** Normalise a possibly-repeated query parameter into an array. */
export function toArray(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const arr = Array.isArray(value) ? value : [value];
  return arr.length > 0 ? arr : undefined;
}

/** Convert a rupee string from a form input into paise. */
export function rupeesToPaiseInput(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric)) return undefined;
  return Math.round(numeric * 100);
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

/**
 * One row of a catalogue import.
 *
 * Everything is optional except the title, so a partial spreadsheet works; the
 * importer reports exactly which rows failed and why rather than rejecting the
 * whole file.
 */
export const bookImportRowSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  author: z.string().trim().min(1, 'Author is required'),
  publisher: z.string().trim().optional(),
  genre: z.string().trim().optional(),
  isbn13: z.string().trim().optional(),
  isbn10: z.string().trim().optional(),
  format: z.string().trim().optional(),
  language: z.string().trim().optional(),
  edition: z.string().trim().optional(),
  price: z.string().trim().optional(),
  sale_price: z.string().trim().optional(),
  page_count: z.string().trim().optional(),
  publication_date: z.string().trim().optional(),
  description: z.string().trim().optional(),
  cover_image_url: z.string().trim().optional(),
  stock: z.string().trim().optional(),
  status: z.string().trim().optional(),
  meta_title: z.string().trim().optional(),
  meta_description: z.string().trim().optional(),
});
export type BookImportRow = z.infer<typeof bookImportRowSchema>;

export interface ImportRowError {
  row: number;
  field: string;
  message: string;
  value?: string;
}

/** Validate one import row, collecting every error rather than stopping at the first. */
export function validateImportRow(
  raw: Record<string, string>,
  rowNumber: number,
): { ok: true; data: BookImportRow } | { ok: false; errors: ImportRowError[] } {
  const result = bookImportRowSchema.safeParse(raw);

  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => ({
        row: rowNumber,
        field: issue.path.join('.') || 'row',
        message: issue.message,
      })),
    };
  }

  const errors: ImportRowError[] = [];
  const data = result.data;

  if (data.isbn13) {
    const parsed = isValidIsbn(data.isbn13);
    if (!parsed.valid) {
      errors.push({ row: rowNumber, field: 'isbn13', message: 'Invalid ISBN-13 check digit.', value: data.isbn13 });
    }
  }

  const price = rupeesToPaiseInput(data.price);
  if (price === undefined) {
    errors.push({ row: rowNumber, field: 'price', message: 'Price is required and must be a number.', value: data.price ?? '' });
  } else if (price <= 0) {
    errors.push({ row: rowNumber, field: 'price', message: 'Price must be greater than zero.', value: data.price });
  }

  const salePrice = rupeesToPaiseInput(data.sale_price);
  if (salePrice !== undefined && price !== undefined && salePrice >= price) {
    errors.push({
      row: rowNumber,
      field: 'sale_price',
      message: 'Sale price must be lower than the list price.',
      value: data.sale_price,
    });
  }

  if (data.format) {
    const validFormats = Object.values(BOOK_FORMAT) as string[];
    if (!validFormats.includes(data.format.toLowerCase())) {
      errors.push({
        row: rowNumber,
        field: 'format',
        message: `Format must be one of: ${validFormats.join(', ')}.`,
        value: data.format,
      });
    }
  }

  if (data.status && !['draft', 'active', 'archived'].includes(data.status.toLowerCase())) {
    errors.push({ row: rowNumber, field: 'status', message: 'Status must be draft, active or archived.', value: data.status });
  }

  if (data.publication_date && Number.isNaN(Date.parse(data.publication_date))) {
    errors.push({
      row: rowNumber,
      field: 'publication_date',
      message: 'Use an ISO date, e.g. 2025-03-14.',
      value: data.publication_date,
    });
  }

  if (data.stock !== undefined && data.stock !== '' && !/^\d+$/.test(data.stock)) {
    errors.push({ row: rowNumber, field: 'stock', message: 'Stock must be a whole number.', value: data.stock });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data };
}
