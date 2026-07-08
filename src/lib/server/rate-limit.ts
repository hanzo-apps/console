/**
 * In-process sliding-window rate limiter — the ONE per-IP throttle for the
 * console's hand-rolled BFF routes that mutate from the open internet (signup).
 *
 * WHY here. `/auth/signup` creates an account + org + a $5 welcome grant from an
 * UNAUTHENTICATED caller, so it is the console's one real spam/cost surface. The
 * gateway (api.hanzo.ai) rate-limits `/v1/*`, but `/auth/*` are first-party BFF
 * routes that never leave the console origin, so nothing throttles them upstream —
 * this does.
 *
 * Intentionally minimal (mirrors `plugins/waitlist/ratelimit.go`): O(N) in the hit
 * count per key, GC-on-read, no background goroutine/timer. PER-REPLICA (in-memory),
 * so it is a first-line abuse floor, not a distributed quota — the durable guards are
 * Turnstile (bot wall) + the deterministic per-email org slug (one account per email).
 * For a hard cross-replica quota the host puts a real proxy/Valkey limit in front;
 * this keeps a single box safe with zero new dependency.
 */

/** One sliding-window limiter keyed by an arbitrary string (IP, `ip:route`, …). */
export class SlidingWindow {
  private readonly hits = new Map<string, number[]>()
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when `key` is under the limit; records the hit. `limit <= 0` disables. */
  allow(key: string): boolean {
    if (this.limit <= 0) return true
    const t = this.now()
    const cutoff = t - this.windowMs
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(t)
    this.hits.set(key, recent)
    return true
  }
}

/** signup throttle: env-tunable, default 5 accounts / IP / hour. `<=0` disables. */
const SIGNUP_LIMIT = Number(process.env.SIGNUP_RATE_LIMIT ?? 5)
const SIGNUP_WINDOW_MS = Number(process.env.SIGNUP_RATE_WINDOW_MS ?? 60 * 60 * 1000)

/** The shared signup limiter (module singleton so it persists across requests). */
export const signupLimiter = new SlidingWindow(SIGNUP_LIMIT, SIGNUP_WINDOW_MS)

/**
 * Best-effort client IP for a request. The ingress sets `x-forwarded-for`
 * (`client, proxy1, …`) — the FIRST hop is the real client; `x-real-ip` is the
 * fallback. Returns '' when neither is present (dev/direct), which the caller treats
 * as a single shared bucket rather than skipping the limit.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return (headers.get('x-real-ip') ?? '').trim()
}
