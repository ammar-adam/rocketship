/**
 * Rate Limiting for API Routes
 *
 * Simple in-memory rate limiting based on IP address.
 * For production, consider using Vercel Edge Config or Redis.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store (resets on serverless cold start)
const store = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}, 60000); // Every minute

export interface RateLimitConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Identifier prefix (e.g., 'debate', 'optimize') */
  identifier?: string;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

/**
 * Check rate limit for a given key (usually IP address)
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const fullKey = config.identifier ? `${config.identifier}:${key}` : key;
  const entry = store.get(fullKey);

  if (!entry || entry.resetAt < now) {
    // Create new entry
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + config.windowMs
    };
    store.set(fullKey, newEntry);
    return {
      success: true,
      remaining: config.limit - 1,
      resetAt: newEntry.resetAt
    };
  }

  if (entry.count >= config.limit) {
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterMs: entry.resetAt - now
    };
  }

  // Increment counter
  entry.count++;
  return {
    success: true,
    remaining: config.limit - entry.count,
    resetAt: entry.resetAt
  };
}

/**
 * Get client IP from request headers
 * Works with Vercel, Cloudflare, and standard proxies
 */
export function getClientIp(headers: Headers): string {
  // Vercel
  const vercelIp = headers.get('x-real-ip');
  if (vercelIp) return vercelIp;

  // Cloudflare
  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;

  // Standard proxy
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const ips = forwarded.split(',').map(ip => ip.trim());
    if (ips[0]) return ips[0];
  }

  // Fallback
  return 'unknown';
}

// Predefined rate limit configurations
export const RATE_LIMITS = {
  // Heavy endpoints (debate, optimize)
  heavy: {
    limit: 5,
    windowMs: 60 * 1000, // 5 per minute
    identifier: 'heavy'
  },
  // Medium endpoints (run creation)
  medium: {
    limit: 10,
    windowMs: 60 * 1000, // 10 per minute
    identifier: 'medium'
  },
  // Light endpoints (status polling)
  light: {
    limit: 60,
    windowMs: 60 * 1000, // 60 per minute
    identifier: 'light'
  },
  // Debug endpoints
  debug: {
    limit: 20,
    windowMs: 60 * 1000, // 20 per minute
    identifier: 'debug'
  }
} as const;

/**
 * Create a rate limit error response
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  const retryAfter = result.retryAfterMs ? Math.ceil(result.retryAfterMs / 1000) : 60;
  return new Response(
    JSON.stringify({
      error: 'Too many requests',
      retryAfterSeconds: retryAfter
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000))
      }
    }
  );
}
