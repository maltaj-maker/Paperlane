/**
 * Role-based access control.
 *
 * Least privilege by construction: permissions are explicit strings, roles are
 * named bundles of them, and `requirePermission()` is checked server-side on
 * every mutating route. The UI hides what a user cannot do, but hiding is
 * cosmetic — the server check is the actual control.
 *
 * Adding a new capability means adding a permission constant here and granting
 * it to the roles that need it. There is no implicit "admin bypass".
 */

export const PERMISSIONS = {
  // Catalogue
  BOOK_READ: 'book:read',
  BOOK_WRITE: 'book:write',
  BOOK_DELETE: 'book:delete',
  BOOK_IMPORT: 'book:import',
  // Inventory
  INVENTORY_READ: 'inventory:read',
  INVENTORY_WRITE: 'inventory:write',
  INVENTORY_ADJUST: 'inventory:adjust',
  // Orders
  ORDER_READ: 'order:read',
  ORDER_WRITE: 'order:write',
  ORDER_REFUND: 'order:refund',
  ORDER_CANCEL: 'order:cancel',
  ORDER_EXPORT: 'order:export',
  // Customers
  CUSTOMER_READ: 'customer:read',
  CUSTOMER_WRITE: 'customer:write',
  CUSTOMER_DELETE: 'customer:delete',
  // Content
  CONTENT_READ: 'content:read',
  CONTENT_WRITE: 'content:write',
  CONTENT_PUBLISH: 'content:publish',
  // Marketing
  PROMO_READ: 'promo:read',
  PROMO_WRITE: 'promo:write',
  // Support
  SUPPORT_READ: 'support:read',
  SUPPORT_WRITE: 'support:write',
  // Reviews
  REVIEW_MODERATE: 'review:moderate',
  // Analytics / settings / security
  ANALYTICS_READ: 'analytics:read',
  SETTINGS_WRITE: 'settings:write',
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
  AUDIT_READ: 'audit:read',
  FEATURE_FLAG_WRITE: 'feature_flag:write',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE = {
  OWNER: 'owner',
  ADMIN: 'admin',
  INVENTORY_MANAGER: 'inventory_manager',
  ORDER_MANAGER: 'order_manager',
  CONTENT_MANAGER: 'content_manager',
  SUPPORT: 'support',
  MARKETING: 'marketing',
  CUSTOMER: 'customer',
} as const;

export type RoleName = (typeof ROLE)[keyof typeof ROLE];

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  inventory_manager: 'Inventory Manager',
  order_manager: 'Order Manager',
  content_manager: 'Content Manager',
  support: 'Customer Support',
  marketing: 'Marketing',
  customer: 'Customer',
};

export const ROLE_DESCRIPTION: Record<string, string> = {
  owner: 'Full control including roles, settings and audit logs.',
  admin: 'Day-to-day operations across catalogue, orders, customers and content.',
  inventory_manager: 'Stock levels, warehouses, receiving, adjustments and imports.',
  order_manager: 'Orders, fulfilment, shipping, cancellations and refunds.',
  content_manager: 'Catalogue metadata, CMS pages, blog posts and banners.',
  support: 'Customer records, support tickets, order lookup and review moderation.',
  marketing: 'Promotions, coupons, campaigns, analytics and newsletter.',
  customer: 'Storefront shopper. No back-office access.',
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

/** Reads-only subset, reused by several operational roles. */
const READONLY_CATALOGUE = [
  PERMISSIONS.BOOK_READ,
  PERMISSIONS.INVENTORY_READ,
  PERMISSIONS.ORDER_READ,
] as const;

/**
 * Role → permission bundles.
 *
 * Note deliberate exclusions: Marketing cannot touch inventory; Support cannot
 * refund without an order manager; Inventory Manager cannot read customer PII.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  [ROLE.OWNER]: ALL_PERMISSIONS,

  [ROLE.ADMIN]: ALL_PERMISSIONS.filter(
    (p) => p !== PERMISSIONS.ROLE_MANAGE, // only the owner mints roles
  ),

  [ROLE.INVENTORY_MANAGER]: [
    ...READONLY_CATALOGUE,
    PERMISSIONS.BOOK_WRITE,
    PERMISSIONS.BOOK_IMPORT,
    PERMISSIONS.INVENTORY_WRITE,
    PERMISSIONS.INVENTORY_ADJUST,
    PERMISSIONS.ANALYTICS_READ,
  ],

  [ROLE.ORDER_MANAGER]: [
    ...READONLY_CATALOGUE,
    PERMISSIONS.ORDER_WRITE,
    PERMISSIONS.ORDER_CANCEL,
    PERMISSIONS.ORDER_REFUND,
    PERMISSIONS.ORDER_EXPORT,
    PERMISSIONS.CUSTOMER_READ,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.SUPPORT_READ,
    PERMISSIONS.SUPPORT_WRITE,
  ],

  [ROLE.CONTENT_MANAGER]: [
    ...READONLY_CATALOGUE,
    PERMISSIONS.BOOK_WRITE,
    PERMISSIONS.CONTENT_READ,
    PERMISSIONS.CONTENT_WRITE,
    PERMISSIONS.CONTENT_PUBLISH,
    PERMISSIONS.REVIEW_MODERATE,
  ],

  [ROLE.SUPPORT]: [
    ...READONLY_CATALOGUE,
    PERMISSIONS.CUSTOMER_READ,
    PERMISSIONS.SUPPORT_READ,
    PERMISSIONS.SUPPORT_WRITE,
    PERMISSIONS.REVIEW_MODERATE,
    PERMISSIONS.ORDER_WRITE,
  ],

  [ROLE.MARKETING]: [
    PERMISSIONS.BOOK_READ,
    PERMISSIONS.PROMO_READ,
    PERMISSIONS.PROMO_WRITE,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.CONTENT_READ,
    PERMISSIONS.CONTENT_WRITE,
    PERMISSIONS.CUSTOMER_READ,
  ],

  [ROLE.CUSTOMER]: [],
};

/** Roles that may enter /admin at all. */
export const STAFF_ROLES: RoleName[] = [
  ROLE.OWNER,
  ROLE.ADMIN,
  ROLE.INVENTORY_MANAGER,
  ROLE.ORDER_MANAGER,
  ROLE.CONTENT_MANAGER,
  ROLE.SUPPORT,
  ROLE.MARKETING,
];

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && (STAFF_ROLES as string[]).includes(role);
}

export function permissionsForRole(role: string | null | undefined): Permission[] {
  if (!role) return [];
  return ROLE_PERMISSIONS[role as RoleName] ?? [];
}

export function roleHasPermission(role: string | null | undefined, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function roleHasAnyPermission(
  role: string | null | undefined,
  permissions: Permission[],
): boolean {
  const owned = new Set(permissionsForRole(role));
  return permissions.some((p) => owned.has(p));
}

/** Parse the JSON permission array stored on a custom Role row. */
export function parseStoredPermissions(raw: string | null | undefined): Permission[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is Permission => typeof p === 'string' && ALL_PERMISSIONS.includes(p as Permission));
  } catch {
    return [];
  }
}

export function describePermission(permission: string): string {
  const [resource, action] = permission.split(':');
  const resourceLabel: Record<string, string> = {
    book: 'Catalogue',
    inventory: 'Inventory',
    order: 'Orders',
    customer: 'Customers',
    content: 'Content',
    promo: 'Promotions',
    support: 'Support',
    review: 'Reviews',
    analytics: 'Analytics',
    settings: 'Settings',
    user: 'Users',
    role: 'Roles',
    audit: 'Audit log',
    feature_flag: 'Feature flags',
  };
  const actionLabel: Record<string, string> = {
    read: 'view',
    write: 'edit',
    delete: 'delete',
    import: 'bulk import',
    adjust: 'adjust',
    refund: 'refund',
    cancel: 'cancel',
    export: 'export',
    publish: 'publish',
  };
  return `${actionLabel[action ?? ''] ?? action} ${resourceLabel[resource ?? ''] ?? resource}`.trim();
}
