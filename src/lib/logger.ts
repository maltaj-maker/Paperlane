/**
 * Structured logging.
 *
 * Deliberately dependency-free: a JSON line to stdout is what every log shipper
 * (Datadog, Loki, CloudWatch, Better Stack) already understands, and it keeps our
 * cold-start bundle small.
 *
 * SECURITY: `redact()` runs over every payload. Card numbers, CVVs, session
 * tokens, passwords and provider salts must never reach a log file — logs get
 * exported, screenshotted into tickets, and shipped to third parties.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|salt|authorization|auth|cookie|card|cvv|cvc|pan|otp|pin|apikey|api_key|private|credential|signature|saltkey|salt_key)/i;

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  // 13-19 digit sequences that look like a PAN (allow spaces/dashes)
  /\b(?:\d[ -]?){13,19}\b/,
  // JWT-ish or long opaque bearer tokens
  /\b[A-Za-z0-9_-]{40,}\b/,
];

const REDACTED = '[REDACTED]';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/** Deep-clone a payload with sensitive fields replaced. Bounded depth. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    let out = value;
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      out = out.replace(pattern, REDACTED);
    }
    return out;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }
  // Prisma Decimal, BigInt, etc.
  return String(value);
}

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (raw in LEVEL_RANK) return raw as LogLevel;
  return 'info';
}

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  fatal(msg: string, ctx?: LogContext): void;
  /** Returns a logger that merges `bindings` into every line. */
  child(bindings: LogContext): Logger;
}

function emit(level: LogLevel, msg: string, bindings: LogContext, ctx?: LogContext): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel()]) return;

  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(redact(bindings) as Record<string, unknown>),
    ...(ctx ? (redact(ctx) as Record<string, unknown>) : {}),
  };

  const line =
    process.env.LOG_FORMAT === 'pretty'
      ? formatPretty(level, msg, record)
      : JSON.stringify(record);

  if (level === 'error' || level === 'fatal') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function formatPretty(level: LogLevel, msg: string, record: Record<string, unknown>): string {
  const time = new Date().toISOString().slice(11, 23);
  const tag = level.toUpperCase().padEnd(5);
  const extra = Object.entries(record)
    .filter(([k]) => !['ts', 'level', 'msg'].includes(k))
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
  return `${time} ${tag} ${msg}${extra ? '  ' + extra : ''}`;
}

function createLogger(bindings: LogContext): Logger {
  return {
    debug: (m, c) => emit('debug', m, bindings, c),
    info: (m, c) => emit('info', m, bindings, c),
    warn: (m, c) => emit('warn', m, bindings, c),
    error: (m, c) => emit('error', m, bindings, c),
    fatal: (m, c) => emit('fatal', m, bindings, c),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger({ app: 'paperlane' });

/** Convenience for request-scoped logging. */
export function requestLogger(route: string, extra: LogContext = {}): Logger {
  return logger.child({ route, ...extra });
}

/**
 * Time an async operation and log it if it is slow. Used around DB-heavy paths
 * so "slow query" monitoring is built in rather than bolted on.
 */
export async function timed<T>(
  log: Logger,
  label: string,
  fn: () => Promise<T>,
  slowMs = 500,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - started;
    if (ms >= slowMs) log.warn(`slow: ${label}`, { ms });
    else log.debug(label, { ms });
    return result;
  } catch (err) {
    log.error(`failed: ${label}`, { ms: Date.now() - started, err });
    throw err;
  }
}
