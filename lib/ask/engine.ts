// The "ask the data" engine, shared by every portal (lib/ask/portals.ts).
//
// Two AI calls per question, with the SQL run in between in the visitor's own
// browser (DuckDB-WASM over the portal's parquet files):
//   1. plan:  question -> up to 3 SQL queries + how to chart each
//   2. write: question + the queries' real result rows -> the story text
// The AI never sees the data before writing the queries and only sees the
// actual result rows when writing the story, so every number shown comes from
// a query the visitor can inspect. No AI-written SQL runs on the server.

import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { costOf, recordSpend, Usage } from './guard'
import { Portal } from './portals'

// Sonnet rather than Haiku: it writes noticeably more accurate SQL and stories.
// Override with ASK_MODEL (TORONTO_MODEL is the older name).
const MODEL = process.env.ASK_MODEL || process.env.TORONTO_MODEL || 'claude-sonnet-5-5'
const TOKEN_TTL_MS = 10 * 60 * 1000

export const MAX_QUESTION_LENGTH = 300
export const MAX_QUERIES = 3
export const MAX_ROWS = 30

const planSystem = (p: Portal) => `You help non-technical people get answers from ${p.datasets.length} open datasets published by ${p.owner} (the tables below). You write DuckDB SQL; the queries run elsewhere and you never see the data at this step.

${p.notes}

Always answer by calling the reply tool (never plain text), in one of these two shapes.

If the question can be answered (even partly) from these tables:
{"answerable": true, "datasets": ["table names used", ...], "queries": [
  {"id": "q1", "purpose": "what this shows, one short phrase", "chart": "columns" | "bars", "unit": "people" | "delays" | "minutes" | ..., "sql": "SELECT ... AS label, ... AS value FROM ..."}
]}

Rules for queries:
- 2 or 3 queries, each a different angle that helps answer the question. The first one answers it most directly.
- Each query returns EXACTLY two columns and ONE row per label (labels are unique): "label" (short readable text, e.g. strftime(date, '%b') for months, weekday names, years as text, decades as CAST((year // 10) * 10 AS VARCHAR) || 's', readable names instead of codes) and "value" (a number, rounded).
- At most ${MAX_ROWS} rows (use LIMIT). Rankings: ORDER BY value DESC. Time or ordered categories: chronological order.
- chart "columns" for time or ordered categories; "bars" for rankings with longer labels.
- Never chart a rank as the value (a bigger bar would mean a worse rank); chart the underlying count instead.
- To compare groups over time, write one query per group or pick the single most useful split; never return a third column.
- Only SELECT from the tables above. Standard DuckDB functions only.
- Averages per day/month/year are usually clearer than totals across uneven periods. Name the unit honestly ("riders per day", "delays per month").
- Before writing each query, check it actually measures what its purpose says.

If the question can't be answered from these tables (another topic, or data they don't contain):
{"answerable": false, "message": "one plain sentence saying this isn't in the datasets connected here", "search": "2-4 keywords to search the full ${p.source.name} catalogue for it", "suggestions": ["three short questions these tables CAN answer, close to what was asked"]}`

const REPAIR_NOTE = `Some of your queries failed when run. Fix them and reply with the same shape, containing all queries (fixed ones and ones that worked).`

const writeSystem = (p: Portal) => `You turn query results into a short data story for people with no technical or statistics background, like a good newspaper explainer: it should make sense in five seconds and be worth reading for a minute.

What the data is (${p.owner}):
${p.notes}

You get the question and a numbered list of charts, each with its purpose, its SQL and its result rows (label, value).

Always answer by calling the reply tool (never plain text):
{"workings": ["before writing, one line for every number you will write that isn't copied straight from a row, and every count or comparison, showing the arithmetic or the items counted, e.g. \"427.4 - 369.7 = 57.7\", \"top 10 in 1980-1985: 1980, 1981, 1982, 1983, 1984, 1985 = 6\", \"921.5 / 213.7 = 4.3\""],
 "lead": "the direct answer as a headline, at most 10 words, e.g. \"Zimbabwe's prices rose fastest, by far.\"",
 "highlight": "the 1-3 most important words of lead, copied exactly, e.g. \"Zimbabwe\"",
 "summary": "2 or 3 sentences for someone in a hurry: the answer, the number that proves it, and what that number means in everyday terms",
 "sub": "one short line on what data and period this is based on",
 "facts": [{"value": "a number, formatted, e.g. 921.5% or 15,806 or $128,678", "label": "what it is, under 10 words"}],
 "points": [{"h": "headline for this chart, at most 10 words, saying what it shows", "p": "2 or 3 sentences about this chart"}],
 "note": "one plain sentence the reader should keep in mind (what is counted, which years, an unusual unit), or an empty string",
 "next": ["three short follow-up questions"]}

How to write:
- Everyday words and short sentences, for a curious reader who has never seen this data. No jargon: say "prices rose 921% in a year", not "CPI inflation was 921%". If a unit isn't obvious (ppm, an index), explain it once in plain words.
- Make the numbers mean something: compare them ("more than four times the next country", "one in five", "twice as high as in 2000") or translate them ("a 921% rise means prices were about ten times higher at the end of the year"). Use only simple arithmetic on the rows, and only comparisons you have worked out in "workings". A comparison that is wrong is far worse than none: when unsure, just give the numbers.
- In "summary" and each "p", wrap the 2 or 3 numbers that matter most in double asterisks, e.g. **921.5%**, **four times**. No other formatting.
- "facts": exactly 3. The first is the single most telling number; the other two add something new (not the same number again). Values are plain text, no asterisks.
- "points" has exactly one entry per chart, in the same order, and each talks about its own chart: what it shows and the one thing to notice. Don't just list the rows.
- "sub" states the real period, taken from the SQL and rows and the data notes above.

Rules:
- Every number you write must appear in the rows or be a simple calculation from them (sum, share, difference, ratio). Never invent numbers. Round sensibly ("about 27,000%") when it reads better.
- Only describe what the numbers show. Never explain why (no causes, motives, tourism, weather, the pandemic as a reason, data quality, "limited data"), unless the rows themselves show it. Calling 2020 the pandemic year is fine.
- Only mention things that are in the rows. If a row looks odd or tiny, leave it out rather than comment on it.
- "next" questions must be answerable from the columns listed above (any of the tables). Never suggest things the tables don't have.
- If the results don't really answer the question, say so plainly in "lead".
- Write names in normal case (Luna, Kipling station), not upper case.`

export interface PlannedQuery {
  id: string
  purpose: string
  chart: 'columns' | 'bars'
  unit: string
  sql: string
}

export type Plan =
  | { answerable: true; datasets: string[]; queries: PlannedQuery[] }
  | { answerable: false; message: string; search: string; suggestions: string[] }

export interface CatalogueHit {
  title: string
  url: string
  note: string
}

export interface QueryResult {
  id: string
  purpose: string
  sql: string
  unit: string
  rows: { label: string; value: number }[]
}

export interface Story {
  lead: string
  highlight: string
  summary: string // **x** marks a highlighted number
  sub: string
  facts: { value: string; label: string }[]
  points: { h: string; p: string }[]
  note: string
  next: string[]
  workings: string[] // the AI's arithmetic for the comparisons in the text; not shown, kept for checking
}

// The reply comes back as a "reply" tool call, so the API hands us parsed
// JSON instead of us parsing text the model typed (SQL with quotes in it
// broke that). Newer models don't accept a forced tool_choice, so the prompt
// asks for the tool and plain-text JSON is the fallback. Every call's token
// usage is priced and added to the month's spend (lib/ask/guard.ts).
async function callClaude(system: string, user: string, maxTokens: number, schema: Record<string, unknown>): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured on the server.')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      // The system prompt (the portal's data notes) is the same on every call, so cache it.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'reply', description: 'Send your reply.', input_schema: schema }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Anthropic request failed: ${res.status} ${detail.slice(0, 300)}`)
  }
  const json = await res.json()
  const usd = costOf((json.usage || {}) as Usage)
  await recordSpend(usd)
  console.log(JSON.stringify({ event: 'ask_ai_usage', model: MODEL, usage: json.usage, usd: Number(usd.toFixed(5)) }))
  const block = (Array.isArray(json.content) ? json.content : []).find((c: { type?: string }) => c.type === 'tool_use')
  if (block) return block.input
  const text: string = (Array.isArray(json.content) ? json.content : [])
    .filter((c: { type?: string }) => c.type === 'text')
    .map((c: { text?: string }) => c.text || '')
    .join('')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`The model sent no reply (stop: ${json.stop_reason}, text: ${text.slice(0, 120)})`)
  return JSON.parse(text.slice(start, end + 1))
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    answerable: { type: 'boolean' },
    datasets: { type: 'array', items: { type: 'string' } },
    queries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          purpose: { type: 'string' },
          chart: { type: 'string', enum: ['columns', 'bars'] },
          unit: { type: 'string' },
          sql: { type: 'string' },
        },
        required: ['id', 'purpose', 'chart', 'unit', 'sql'],
      },
    },
    message: { type: 'string' },
    search: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['answerable'],
}

const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    workings: { type: 'array', items: { type: 'string' } },
    lead: { type: 'string' },
    highlight: { type: 'string' },
    summary: { type: 'string' },
    sub: { type: 'string' },
    facts: {
      type: 'array',
      items: { type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' } }, required: ['value', 'label'] },
    },
    points: {
      type: 'array',
      items: { type: 'object', properties: { h: { type: 'string' }, p: { type: 'string' } }, required: ['h', 'p'] },
    },
    note: { type: 'string' },
    next: { type: 'array', items: { type: 'string' } },
  },
  required: ['workings', 'lead', 'highlight', 'summary', 'sub', 'facts', 'points', 'note', 'next'],
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function cleanPlan(raw: unknown): Plan {
  const r = (raw || {}) as Record<string, unknown>
  if (r.answerable === false) {
    return {
      answerable: false,
      message: str(r.message, 400) || "These datasets can't answer that question.",
      search: str(r.search, 80),
      suggestions: (Array.isArray(r.suggestions) ? r.suggestions : []).map((s) => str(s, 120)).filter(Boolean).slice(0, 3),
    }
  }
  const queries = (Array.isArray(r.queries) ? r.queries : [])
    .map((q, i): PlannedQuery => {
      const o = (q || {}) as Record<string, unknown>
      return {
        id: str(o.id, 10) || `q${i + 1}`,
        purpose: str(o.purpose, 160),
        chart: o.chart === 'bars' ? 'bars' : 'columns',
        unit: str(o.unit, 30),
        sql: str(o.sql, 3000),
      }
    })
    .filter((q) => q.sql)
    .slice(0, MAX_QUERIES)
  if (!queries.length) throw new Error('The model returned no queries.')
  const datasets = (Array.isArray(r.datasets) ? r.datasets : []).map((d) => str(d, 40)).filter(Boolean)
  return { answerable: true, datasets, queries }
}

export async function planQueries(portal: Portal, question: string, failed?: { sql: string; error: string }[], previous?: PlannedQuery[]): Promise<Plan> {
  let user = `Question: ${question}`
  if (failed?.length && previous?.length) {
    user += `\n\nYour previous queries:\n${JSON.stringify(previous)}\n\n${REPAIR_NOTE}\n${failed
      .map((f) => `SQL: ${f.sql}\nError: ${f.error}`)
      .join('\n\n')}`
  }
  // The model's thinking counts towards max_tokens, so leave room; output is billed by actual use.
  // A reply cut short comes back without queries: try once more.
  try {
    return cleanPlan(await callClaude(planSystem(portal), user, 4000, PLAN_SCHEMA))
  } catch (err) {
    if (!(err instanceof Error && err.message === 'The model returned no queries.')) throw err
    return cleanPlan(await callClaude(planSystem(portal), user, 4000, PLAN_SCHEMA))
  }
}

export async function writeStory(portal: Portal, question: string, results: QueryResult[]): Promise<Story> {
  const today = new Date().toISOString().slice(0, 10)
  const charts = results.map(({ purpose, sql, unit, rows }, i) => `Chart ${i + 1}: ${purpose}\nUnit: ${unit}\nSQL: ${sql}\nRows: ${JSON.stringify(rows)}`)
  const user = `Today is ${today}. The data was downloaded on ${portal.data.snapshot}.\nQuestion: ${question}\n\n${charts.join('\n\n')}\n\nWrite exactly ${results.length} points, one per chart.`
  // Now and then the reply comes back with only the headline filled in; ask once more, then give up
  // rather than show (and cache) a story with empty chapters.
  const filled = (v: unknown) => typeof v === 'string' && v.trim() !== ''
  const complete = (x: Record<string, unknown>) =>
    filled(x.summary) && Array.isArray(x.points) && x.points.length >= results.length && x.points.every((p) => filled((p as Record<string, unknown>)?.p))
  let r = ((await callClaude(writeSystem(portal), user, 4000, WRITE_SCHEMA)) || {}) as Record<string, unknown>
  if (!complete(r)) r = ((await callClaude(writeSystem(portal), user, 4000, WRITE_SCHEMA)) || {}) as Record<string, unknown>
  if (!complete(r)) throw new Error('The model returned an incomplete story.')
  const points = (Array.isArray(r.points) ? r.points : []).slice(0, results.length).map((p) => {
    const o = (p || {}) as Record<string, unknown>
    return { h: str(o.h, 120), p: str(o.p, 600) }
  })
  while (points.length < results.length) points.push({ h: results[points.length].purpose, p: '' })
  const facts = (Array.isArray(r.facts) ? r.facts : [])
    .map((f) => {
      const o = (f || {}) as Record<string, unknown>
      return { value: str(o.value, 24).replace(/\*/g, ''), label: str(o.label, 100) }
    })
    .filter((f) => f.value && f.label)
    .slice(0, 3)
  return {
    lead: str(r.lead, 160),
    highlight: str(r.highlight, 80),
    summary: str(r.summary, 600),
    sub: str(r.sub, 200),
    facts,
    points,
    note: str(r.note, 300),
    next: (Array.isArray(r.next) ? r.next : []).map((s) => str(s, 120)).filter(Boolean).slice(0, 3),
    workings: (Array.isArray(r.workings) ? r.workings : []).map((s) => str(s, 200)).filter(Boolean).slice(0, 20),
  }
}

// Validates and trims result rows sent back from the browser before they go
// to the model, so the write step can't be used as a general-purpose prompt.
export function cleanResults(raw: unknown): QueryResult[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_QUERIES) return null
  const out: QueryResult[] = []
  for (const item of raw) {
    const o = (item || {}) as Record<string, unknown>
    if (!Array.isArray(o.rows)) return null
    const rows = o.rows.slice(0, MAX_ROWS).map((row) => {
      const r = (row || {}) as Record<string, unknown>
      return { label: str(String(r.label ?? ''), 60), value: Number(r.value) }
    })
    if (rows.some((r) => !Number.isFinite(r.value))) return null
    out.push({ id: str(o.id, 10), purpose: str(o.purpose, 160), sql: str(o.sql, 3000), unit: str(o.unit, 30), rows })
  }
  return out
}

// ---- cache keys ----
// Questions are matched loosely (case, punctuation), per portal and data snapshot,
// so a data refresh starts a fresh cache. A story is cached against the exact
// result rows it was written from: rows sent by a tampered client hash
// differently, so they can't overwrite what honest visitors see.

export const normQuestion = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const sha = (s: string) => createHash('sha256').update(s).digest('base64url').slice(0, 32)
export const planKey = (p: Portal, q: string) => `plan:${p.slug}:${p.data.snapshot}:${sha(normQuestion(q))}`
export const storyKey = (p: Portal, q: string, results: QueryResult[]) =>
  `story3:${p.slug}:${p.data.snapshot}:${sha(normQuestion(q) + JSON.stringify(results.map((r) => [r.sql, r.rows])))}`
// The headline and summary of an answer, kept per question so a shared link
// (?q=...) can show them in link previews (pages/api/share.ts).
export const shareKey = (p: Portal, q: string) => `share:${p.slug}:${p.data.snapshot}:${sha(normQuestion(q))}`


// ---- tokens ----
// A short-lived signed token ties the write step (and at most one query repair)
// to a plan step for the same portal and question. `counted` records whether
// that plan step used up a live question; a write for an uncounted (cached)
// plan that then needs the AI is counted at that point instead.

function secret() {
  return process.env.ASK_TOKEN_SECRET || process.env.TORONTO_TOKEN_SECRET || process.env.ANTHROPIC_API_KEY || 'dev-only-secret'
}
function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}
export function issueToken(slug: string, question: string, counted: boolean): string {
  const exp = Date.now() + TOKEN_TTL_MS
  const nonce = Math.random().toString(36).slice(2, 10)
  const c = counted ? '1' : '0'
  return `${exp}.${nonce}.${c}.${sign(`${exp}.${nonce}.${c}.${slug}.${question}`)}`
}

const spent = new Map<string, number>() // `${use}:${token}` -> expiry
export function useToken(token: unknown, slug: string, question: string, use: 'write' | 'repair'): { counted: boolean } | null {
  if (typeof token !== 'string') return null
  const [exp, nonce, c, sig] = token.split('.')
  if (!exp || !nonce || !c || !sig || Number(exp) < Date.now()) return null
  const expected = Buffer.from(sign(`${exp}.${nonce}.${c}.${slug}.${question}`))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  const now = Date.now()
  if (spent.size > 5000) for (const [k, e] of spent) if (e < now) spent.delete(k)
  const key = `${use}:${token}`
  if (spent.has(key)) return null
  spent.set(key, Number(exp))
  return { counted: c === '1' }
}

// ---- catalogue search ----
// For questions the connected tables can't answer: search the portal's full
// catalogue (no AI involved) so the reply can point to datasets that do exist.

export async function searchCatalogue(portal: Portal, terms: string): Promise<CatalogueHit[]> {
  const cat = portal.catalogue
  if (cat.type !== 'ckan' || !cat.api) return []
  const q = terms.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().slice(0, 80)
  if (!q) return []
  const connected = new Set(portal.datasets.map((d) => d.id))
  try {
    const res = await fetch(`${cat.api}/package_search?${new URLSearchParams({ q, rows: '6' })}`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    const json = await res.json()
    const results: Record<string, unknown>[] = json?.result?.results || []
    const page = (name: string) => (cat.datasetUrl || '').replace('{name}', encodeURIComponent(name))
    return results
      .filter((d) => d.is_retired !== true && d.is_retired !== 'true' && !connected.has(String(d.name)))
      .slice(0, 3)
      .map((d) => ({
        title: str(d.title, 120),
        url: page(String(d.name || '')),
        note: str(String(d.excerpt || d.notes || '').replace(/\s+/g, ' '), 160),
      }))
      .filter((d) => d.title && d.url)
  } catch {
    return []
  }
}
