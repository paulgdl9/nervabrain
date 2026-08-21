import type { NextRequest } from "next/server";

// Simple in-memory, per-IP sliding-window rate limiter (S3).
//
// Scope and caveats:
// - In-memory only: counters live in the process heap. They reset on restart
//   and are NOT shared across instances. This deployment runs a single Next.js
//   instance behind one Cloudflare tunnel, so that is acceptable; if you scale
//   horizontally, move this to a shared store (Redis, etc.).
// - Best-effort defence against credential brute-force on /login
//   (DASHBOARD_PASSWORD) and /authorize (CAPTURE_TOKEN), not a DoS shield.
// - A background sweep prunes idle buckets so memory stays bounded.

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweep = 0;

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const cutoff = now - windowMs;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

/**
 * Resolves the client IP behind a Cloudflare proxy: prefer `cf-connecting-ip`,
 * then the first hop of `x-forwarded-for`, then a stable fallback so an absent
 * IP does not silently disable the limiter.
 */
export function clientIp(request: NextRequest): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",", 1)[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Seconds until the caller may retry, when rate-limited. */
  retryAfter: number;
};

/**
 * Records an attempt for `key` and reports whether it is within `limit`
 * attempts per `windowMs`. Uses a sliding window (timestamps of recent hits).
 */
export function rateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): RateLimitResult {
  const { limit, windowMs } = options;
  const now = Date.now();
  sweep(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  const cutoff = now - windowMs;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfter };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.hits.length, retryAfter: 0 };
}

/** Convenience wrapper: rate-limit by client IP under a named scope. */
export function rateLimitRequest(
  request: NextRequest,
  scope: string,
  options: { limit: number; windowMs: number },
): RateLimitResult {
  return rateLimit(`${scope}:${clientIp(request)}`, options);
}

/** Test-only hook to clear all buckets between cases. */
export function resetRateLimitForTests() {
  buckets.clear();
  lastSweep = 0;
}
