// Best-effort per-IP rate limit for the document-search /api/ask endpoints.
// (Live data questions use the shared limits in lib/ask/guard.ts instead.)
//
// This is an in-memory fixed-window counter, not a distributed one: it's
// scoped to a single serverless function instance, so it resets on cold
// start and doesn't share state across concurrent instances under load.
// That's an intentional, cost-appropriate tradeoff for a low-traffic sales
// demo (per the spec's non-goal of production hardening) — it stops casual
// scripting/hammering, not a determined distributed abuser. The real
// backstop against runaway spend is a hard budget cap set directly in the
// Anthropic Console and Voyage dashboard (outside this app's control).

const WINDOW_MS = 24 * 60 * 60 * 1000 // 1 day
const MAX_REQUESTS_PER_WINDOW = 10

interface Bucket {
  count: number
  windowStart: number
}

const buckets = new Map<string, Bucket>()

// Periodically forget stale IPs so this Map can't grow unbounded across a
// long-lived warm instance.
function sweep(now: number) {
  for (const [ip, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) buckets.delete(ip)
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
}

// `scope` keeps separate demos' quotas apart: a visitor's Toronto questions
// don't use up their security/governance questions, and vice versa.
export function checkRateLimit(ip: string, scope = 'ask'): RateLimitResult {
  const now = Date.now()
  if (buckets.size > 5000) sweep(now)

  const key = `${scope}:${ip}`
  const bucket = buckets.get(key)
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1, limit: MAX_REQUESTS_PER_WINDOW }
  }

  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0, limit: MAX_REQUESTS_PER_WINDOW }
  }

  bucket.count += 1
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - bucket.count, limit: MAX_REQUESTS_PER_WINDOW }
}

export function clientIp(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers['x-forwarded-for']
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (first) return first.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}
