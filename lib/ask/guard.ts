// Spend and abuse guardrails for live data questions, shared by every portal.
//
// State lives in Upstash Redis when it's configured (UPSTASH_REDIS_REST_URL +
// UPSTASH_REDIS_REST_TOKEN, or the KV_REST_API_* names Vercel's marketplace
// integration sets), so limits hold across all server instances. Without it
// the same logic runs in memory per instance: fine for local dev and previews,
// leaky in production (each instance counts separately).
//
// Three limits, checked in this order before a question is sent to the AI:
//   1. monthly AI spend (real dollars, from token usage) ...... ASK_MONTHLY_BUDGET_USD
//   2. live questions per day across all portals ............. ASK_DAILY_TOTAL
//   3. live questions per day per visitor (IP) ............... ASK_DAILY_PER_VISITOR
// Cached answers (an earlier identical question on the same data) cost nothing
// and skip all three.

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d)

export const LIMITS = {
  monthlyBudgetUsd: num(process.env.ASK_MONTHLY_BUDGET_USD, 40),
  dailyTotal: num(process.env.ASK_DAILY_TOTAL, 30),
  dailyPerVisitor: num(process.env.ASK_DAILY_PER_VISITOR, 5),
}

// USD per million tokens. Defaults are Sonnet-class list prices; override if the model or prices change.
const PRICE = {
  input: num(process.env.ASK_PRICE_INPUT, 3),
  output: num(process.env.ASK_PRICE_OUTPUT, 15),
  cacheRead: num(process.env.ASK_PRICE_CACHE_READ, 0.3),
  cacheWrite: num(process.env.ASK_PRICE_CACHE_WRITE, 3.75),
}

const DAY = 24 * 60 * 60
export const CACHE_TTL = 30 * DAY

// ---- store: Upstash REST when configured, memory otherwise ----

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
export const sharedStore = !!(REDIS_URL && REDIS_TOKEN)

async function redis(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(REDIS_URL!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(3000),
  })
  if (!res.ok) throw new Error(`Redis ${command[0]} failed: ${res.status}`)
  return ((await res.json()) as { result: unknown }).result
}

const mem = new Map<string, { v: string; exp: number }>()
function memGet(key: string) {
  const e = mem.get(key)
  if (!e) return null
  if (e.exp < Date.now()) { mem.delete(key); return null }
  return e.v
}
function memSet(key: string, v: string, ttl: number) {
  if (mem.size > 5000) for (const [k, e] of mem) if (e.exp < Date.now()) mem.delete(k)
  mem.set(key, { v, exp: Date.now() + ttl * 1000 })
}

async function get(key: string): Promise<string | null> {
  if (!sharedStore) return memGet(key)
  return (await redis(['GET', key])) as string | null
}
async function set(key: string, value: string, ttl: number) {
  if (!sharedStore) return memSet(key, value, ttl)
  await redis(['SET', key, value, 'EX', ttl])
}
async function incrBy(key: string, by: number, ttl: number): Promise<number> {
  if (!sharedStore) {
    const n = Number(memGet(key) || 0) + by
    memSet(key, String(n), ttl)
    return n
  }
  const n = Number(await redis(['INCRBYFLOAT', key, by]))
  if (n === by) await redis(['EXPIRE', key, ttl])
  return n
}

// The store must never take the product down: on a store error, fail open for
// reads of caches and closed for limits (no live question rather than unmetered spend).
const month = () => new Date().toISOString().slice(0, 7)
const day = () => new Date().toISOString().slice(0, 10)

// ---- limits ----

export type Refusal = 'budget' | 'busy' | 'limit'

export async function checkAndCount(ip: string): Promise<Refusal | null> {
  try {
    const spent = Number((await get(`spend:${month()}`)) || 0)
    if (spent >= LIMITS.monthlyBudgetUsd) return 'budget'
    const total = Number((await get(`q:${day()}`)) || 0)
    if (total >= LIMITS.dailyTotal) return 'busy'
    const mine = Number((await get(`q:${day()}:${ip}`)) || 0)
    if (mine >= LIMITS.dailyPerVisitor) return 'limit'
    await incrBy(`q:${day()}`, 1, 2 * DAY)
    await incrBy(`q:${day()}:${ip}`, 1, 2 * DAY)
    return null
  } catch (err) {
    console.error('guard: limit check failed', err)
    return 'busy'
  }
}

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function costOf(u: Usage): number {
  return (
    ((u.input_tokens || 0) * PRICE.input +
      (u.output_tokens || 0) * PRICE.output +
      (u.cache_read_input_tokens || 0) * PRICE.cacheRead +
      (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite) /
    1e6
  )
}

export async function recordSpend(usd: number) {
  try {
    await incrBy(`spend:${month()}`, Number(usd.toFixed(6)), 40 * DAY)
  } catch (err) {
    console.error('guard: could not record spend', err)
  }
}

export async function status() {
  const [spent, total] = await Promise.all([get(`spend:${month()}`), get(`q:${day()}`)])
  return { sharedStore, month: month(), spentUsd: Number(Number(spent || 0).toFixed(4)), questionsToday: Number(total || 0), limits: LIMITS }
}

// ---- answer cache ----

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const v = await get(key)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}

export async function cachePut(key: string, value: unknown) {
  try {
    await set(key, JSON.stringify(value), CACHE_TTL)
  } catch (err) {
    console.error('guard: cache write failed', err)
  }
}
