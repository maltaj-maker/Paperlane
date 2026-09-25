/**
 * Domain constants.
 *
 * SQLite does not support Prisma enums, so every status-like column is a String.
 * These objects are the single source of truth for those values — the database
 * layer, the API, the admin UI and the tests all import from here. Keep it that
 * way; a stray `"pd"` vs `"paid"` typo is the kind of bug that only shows up in
 * production at 2am.
 */

export const USER_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
} as const;
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const BOOK_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;
export type BookStatus = (typeof BOOK_STATUS)[keyof typeof BOOK_STATUS];

export const BOOK_FORMAT = {
  PAPERBACK: 'paperback',
  HARDCOVER: 'hardcover',
  EBOOK: 'ebook',
  AUDIOBOOK: 'audiobook',
} as const;
export type BookFormat = (typeof BOOK_FORMAT)[keyof typeof BOOK_FORMAT];

export const BOOK_FORMAT_LABEL: Record<string, string> = {
  paperback: 'Paperback',
  hardcover: 'Hardcover',
  ebook: 'eBook',
  audiobook: 'Audiobook',
};

export const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
} as const;

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS = {
  UNPAID: 'unpaid',
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  /** Cash on delivery: the order is real, the money has not arrived yet. */
  COD_PENDING: 'cod_pending',
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Not paid',
  pending: 'Payment processing',
  paid: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
  cod_pending: 'Pay on delivery',
};

export const FULFILLMENT_STATUS = {
  UNFULFILLED: 'unfulfilled',
  PROCESSING: 'processing',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  RETURNED: 'returned',
} as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUS)[keyof typeof FULFILLMENT_STATUS];

export const FULFILLMENT_LABEL: Record<string, string> = {
  unfulfilled: 'Order placed',
  processing: 'Being prepared',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
};

/** Ordered progression used by the order-tracking timeline. */
export const FULFILLMENT_TIMELINE = [
  FULFILLMENT_STATUS.UNFULFILLED,
  FULFILLMENT_STATUS.PROCESSING,
  FULFILLMENT_STATUS.PACKED,
  FULFILLMENT_STATUS.SHIPPED,
  FULFILLMENT_STATUS.DELIVERED,
] as const;

/** Payment lifecycle as reported by a PSP. */
export const PAYMENT_STATE = {
  INITIATED: 'initiated',
  PENDING: 'pending',
  AUTHORIZED: 'authorized',
  CAPTURED: 'captured',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;
export type PaymentState = (typeof PAYMENT_STATE)[keyof typeof PAYMENT_STATE];

/** Payment instrument families, surfaced in the admin UI. */
export const PAYMENT_METHOD = {
  UPI: 'UPI',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  WALLET: 'WALLET',
  COD: 'COD',
} as const;

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  UPI: 'UPI',
  CARD: 'Credit / Debit Card',
  NETBANKING: 'Net Banking',
  WALLET: 'Wallet',
  COD: 'Cash on Delivery',
};

export const SHIPMENT_STATUS = {
  PENDING: 'pending',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  RETURNED: 'returned',
} as const;

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  failed: 'Delivery failed',
  returned: 'Returned to sender',
};

export const REVIEW_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  HIDDEN: 'hidden',
} as const;
export type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS];

export const CART_STATUS = {
  ACTIVE: 'active',
  CONVERTED: 'converted',
  ABANDONED: 'abandoned',
  MERGED: 'merged',
} as const;

export const COUPON_TYPE = {
  PERCENT: 'percent',
  FIXED: 'fixed',
  FREE_SHIPPING: 'free_shipping',
} as const;
export type CouponType = (typeof COUPON_TYPE)[keyof typeof COUPON_TYPE];

export const STOCK_MOVEMENT = {
  RECEIVE: 'receive',
  RESERVE: 'reserve',
  RELEASE: 'release',
  SALE: 'sale',
  RETURN: 'return',
  ADJUST: 'adjust',
  DAMAGE: 'damage',
  LOSS: 'loss',
  CANCEL: 'cancel',
} as const;
export type StockMovementType = (typeof STOCK_MOVEMENT)[keyof typeof STOCK_MOVEMENT];

export const STOCK_MOVEMENT_LABEL: Record<string, string> = {
  receive: 'Stock received',
  reserve: 'Reserved for customer',
  release: 'Reservation released',
  sale: 'Sold',
  return: 'Customer return',
  adjust: 'Manual adjustment',
  damage: 'Damaged in warehouse',
  loss: 'Lost / missing',
  cancel: 'Order cancelled',
};

export const TICKET_STATUS = {
  OPEN: 'open',
  PENDING_CUSTOMER: 'pending_customer',
  PENDING_STAFF: 'pending_staff',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
} as const;

export const TICKET_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  pending_customer: 'Awaiting your reply',
  pending_staff: 'Awaiting support',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const TICKET_CATEGORY_LABEL: Record<string, string> = {
  order_status: 'Where is my order?',
  delivery: 'Delivery problem',
  refund: 'Refund or cancellation',
  product: 'Question about a book',
  account: 'My account',
  other: 'Something else',
};

export const NOTIFICATION_CHANNEL = {
  EMAIL: 'email',
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
  PUSH: 'push',
} as const;

export const NOTIFICATION_STATUS = {
  QUEUED: 'queued',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED_CONSENT: 'skipped_consent',
} as const;

export const BLOG_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;

export const BLOG_CATEGORY_LABEL: Record<string, string> = {
  book_review: 'Book Review',
  reading_guide: "Reading Guide",
  trope_guide: 'Trope Guide',
  author_interview: 'Author Interview',
  recommendation: 'Recommendations',
  news: 'Store News',
};

export const BANNER_PLACEMENT = {
  HOME_HERO: 'home_hero',
  HOME_STRIP: 'home_strip',
  INSTAGRAM_CTA: 'instagram_cta',
  ANNOUNCEMENT: 'announcement',
  CHECKOUT: 'checkout',
} as const;

/**
 * Analytics event names. Centralised so the storefront, the API and the
 * reporting queries can never drift apart.
 */
export const ANALYTICS_EVENT = {
  PAGE_VIEW: 'page_view',
  SEARCH: 'search',
  VIEW_ITEM: 'view_item',
  ADD_TO_CART: 'add_to_cart',
  REMOVE_FROM_CART: 'remove_from_cart',
  BEGIN_CHECKOUT: 'begin_checkout',
  ADD_SHIPPING_INFO: 'add_shipping_info',
  ADD_PAYMENT_INFO: 'add_payment_info',
  PURCHASE: 'purchase',
  COUPON_APPLIED: 'coupon_applied',
  COUPON_FAILED: 'coupon_failed',
  VIEW_PROMOTION: 'view_promotion',
  NEWSLETTER_SIGNUP: 'newsletter_signup',
  INSTAGRAM_DEEP_LINK: 'instagram_deep_link',
  SEARCH_NO_RESULTS: 'search_no_results',
  PAYMENT_FAILED: 'payment_failed',
  WISHLIST_ADD: 'wishlist_add',
  REVIEW_SUBMITTED: 'review_submitted',
} as const;

export const AUDIT_ACTION = {
  BOOK_CREATE: 'book.create',
  BOOK_UPDATE: 'book.update',
  BOOK_DELETE: 'book.delete',
  BOOK_ARCHIVE: 'book.archive',
  PRICE_CHANGE: 'book.price_change',
  CATALOGUE_IMPORT: 'catalogue.import',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_RECEIVE: 'inventory.receive',
  ORDER_CREATE: 'order.create',
  ORDER_STATUS_UPDATE: 'order.status_update',
  ORDER_CANCEL: 'order.cancel',
  ORDER_REFUND: 'order.refund',
  ORDER_TRACKING_ADD: 'order.tracking_add',
  COUPON_CREATE: 'coupon.create',
  COUPON_UPDATE: 'coupon.update',
  COUPON_DELETE: 'coupon.delete',
  USER_ROLE_CHANGE: 'user.role_change',
  USER_SUSPEND: 'user.suspend',
  REVIEW_SUBMIT: 'review.submit',
  REVIEW_MODERATE: 'review.moderate',
  SETTING_UPDATE: 'setting.update',
  FEATURE_FLAG_UPDATE: 'feature_flag.update',
  CONTENT_PUBLISH: 'content.publish',
  CONTENT_UPDATE: 'content.update',
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILED: 'auth.login_failed',
  LOGIN_BLOCKED: 'auth.login_blocked',
  LOGOUT: 'auth.logout',
  PASSWORD_RESET: 'auth.password_reset',
  AFFILIATE_STATUS: 'affiliate.status',
  SUPPORT_TICKET_CREATE: 'support.ticket_create',
  SUPPORT_TICKET_REPLY: 'support.ticket_reply',
  SUPPORT_TICKET_STATUS: 'support.ticket_status',
} as const;

/** Shipping/tax defaults are seeded; these are fallbacks if the DB has no rows. */
export const DEFAULT_FREE_SHIPPING_THRESHOLD_PAISE = 79_900; // ₹799
export const DEFAULT_SHIPPING_RATE_PAISE = 4_900; // ₹49
export const DEFAULT_ESTIMATED_MIN_DAYS = 3;
export const DEFAULT_ESTIMATED_MAX_DAYS = 6;

/**
 * Cap on copies of a single title per order.
 * Keeps a single customer from clearing out stock, which is also a common
 * reseller-abuse pattern for popular titles.
 */
export const DEFAULT_MAX_PER_ORDER = 10;

/** Store policy defaults, overridable from the admin Settings screen. */
export const DEFAULT_RETURN_WINDOW_DAYS = 7;
export const DEFAULT_PAYMENT_WINDOW_MINUTES = 30;

/** Slugs that must never collide with real catalogue entries. */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'account',
  'cart',
  'checkout',
  'login',
  'register',
  'search',
  'books',
  'genres',
  'authors',
  'publishers',
  'collections',
  'blog',
  'legal',
  'support',
  'order',
  'orders',
  'new',
  'new-books',
]);
