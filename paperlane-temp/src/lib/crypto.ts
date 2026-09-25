/**
 * Cryptographic primitives.
 *
 * Choices, and why:
 *  - Passwords: scrypt (Node built-in). Memory-hard, no native build step, and
 *    OWASP-acceptable. Argon2id would be marginally better but needs a native
 *    dependency; scrypt with N=2^15 is a defensible trade-off we can document.
 *  - Session tokens / email tokens: 32 bytes of CSPRNG output, stored only as
 *    SHA-256. A database dump therefore cannot be replayed as a login.
 *  - Comparisons: timingSafeEqual everywhere a secret is compared, so we do not
 *    leak a prefix through response timing.
 *
 * NOTE: scrypt is deliberately slow. Never call these from a render path — only
 * from auth routes and the seed script.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

/**
 * promisify() loses the overload that accepts options (N, r, p, maxmem), so we
 * re-type it explicitly rather than sprinkling casts at the call sites.
 */
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// OWASP-recommended scrypt parameters (2^15 = 32768 cost, 8 blocks, 1 thread).
// keylen 64, and we allow up to ~128MB memory to accommodate maxmem limits.
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

const HASH_PREFIX = 'scrypt';

/**
 * Hash a password for storage. Format: `scrypt$N$r$p$salt$key`, all base64url.
 * Parameters are embedded so we can raise the cost later and still verify old
 * hashes (and transparently re-hash on next successful login).
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer;

  return [
    HASH_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Verify a password against a stored hash. Constant-time with respect to the
 * derived key. Returns false (never throws) for malformed stored hashes so a
 * corrupt row cannot take down the login endpoint.
 */
export async function verifyPassword(password: string, storedHash: string | null): Promise<boolean> {
  if (!password || !storedHash) return false;

  try {
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return false;

    const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
    const N = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    // Reject absurd parameters from a tampered row (DoS protection).
    if (N > 1 << 20 || r > 32 || p > 16) return false;

    const salt = Buffer.from(saltB64!, 'base64url');
    const expected = Buffer.from(keyB64!, 'base64url');

    const derived = (await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    })) as Buffer;

    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash used weaker parameters than we now require. */
export function passwordNeedsRehash(storedHash: string | null): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 6) return true;
  return Number(parts[1]) < SCRYPT_N;
}

/** Cryptographically random, URL-safe token. Default 32 bytes = 256 bits. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateId(): string {
  return randomUUID();
}

/** SHA-256 hex digest. Used for session/token storage lookups. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** HMAC-SHA256, base64-encoded. PhonePe's checksum is built on this. */
export function hmacSha256Base64(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64');
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Timing-safe string comparison. Length differences short-circuit safely. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still perform a comparison to keep timing flat, then return false.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Human-friendly codes for gift cards and order references.
 * Excludes ambiguous characters (0/O, 1/I/L) so a code can be read aloud.
 */
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateHumanCode(length = 12, groupSize = 4): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SAFE_ALPHABET[bytes[i]! % SAFE_ALPHABET.length];
    if (groupSize > 0 && (i + 1) % groupSize === 0 && i + 1 < length) out += '-';
  }
  return out;
}

/** Short numeric-ish reference for support tickets, e.g. "PL-7K2M4Q". */
export function generateReference(prefix = 'PL'): string {
  return `${prefix}-${generateHumanCode(6, 0)}`;
}

/** Normalise an email for storage/lookup (trim + lowercase). */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Mask an identifier for display/logging: "9876543210" -> "98******10".
 * Used on order confirmations and admin screens so staff can confirm a number
 * without the full value being shoulder-surfed.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '••••';
  return `${digits.slice(0, 2)}${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '••••';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
