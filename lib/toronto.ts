// Live questions for the "Ask Toronto's data" homepage (public/home.html).
//
// Two AI calls per question, with the SQL run in between on the visitor's
// own browser (DuckDB-WASM over public/data/toronto/*.parquet):
//   1. plan:  question -> up to 3 SQL queries + how to chart each
//   2. write: question + the queries' real result rows -> the story text
// The AI never sees the data before writing the queries and only sees the
// actual result rows when writing the story, so every number shown comes
// from a query the visitor can inspect. No AI-written SQL runs on the server.

import { createHmac, timingSafeEqual } from 'crypto'

// Sonnet rather than the Haiku the other demos use: it writes noticeably more accurate SQL and
// stories, at about 3 cents a question. Override with TORONTO_MODEL.
const MODEL = process.env.TORONTO_MODEL || 'claude-sonnet-5-5'
const TOKEN_TTL_MS = 10 * 60 * 1000

export const MAX_QUESTION_LENGTH = 300
export const MAX_QUERIES = 3
export const MAX_ROWS = 30

const SCHEMA = `Tables (DuckDB). Snapshot downloaded from open.toronto.ca on 4 Oct 2026.

ferry  -- Toronto Island Ferry Ticket Counts, one row per 15-minute interval
  ts               TIMESTAMP  -- start of the 15-minute interval, 2015-05-01 to 2026-10-02
  tickets_redeemed INTEGER    -- tickets used = people boarding a ferry to the islands. Use this for ridership.
  tickets_sold     INTEGER    -- tickets sold in that interval
  Notes: each row is ONE 15-MINUTE INTERVAL, so avg(tickets_redeemed) is riders per 15 minutes, not per day.
    For riders per day: sum per day first, then average the daily totals, e.g.
      SELECT avg(day_total) FROM (SELECT date_trunc('day', ts) AS d, sum(tickets_redeemed) AS day_total FROM ferry GROUP BY 1)
    For riders per year or month: sum(tickets_redeemed).
    2016-2025 are the complete years. 2015 starts in May and 2026 ends on 2 Oct; leave them out of year-on-year comparisons.
    There is no route, destination, rider type or capacity information.

subway_delays  -- TTC Subway Delay Data, one row per incident
  date      DATE       -- 2025-01-01 to 2026-08-31
  time      TIME       -- use hour(time) for the hour of day
  weekday   VARCHAR    -- 'Monday' ... 'Sunday'
  station   VARCHAR    -- upper case, e.g. 'KIPLING STATION', 'KENNEDY BD STATION'
  code      VARCHAR    -- TTC delay code
  cause     VARCHAR    -- upper-case description of the code, e.g. 'DISORDERLY PATRON'; NULL for unknown codes
  min_delay INTEGER    -- minutes of delay. Many incidents have 0. Count a "delay" only WHERE min_delay > 0.
  min_gap   INTEGER    -- minutes between trains
  bound     VARCHAR    -- direction: N, S, E, W
  line      VARCHAR    -- 'YU' = Line 1 Yonge-University, 'BD' = Line 2 Bloor-Danforth, 'SHP' = Line 4 Sheppard.
                       -- About 2% of rows have combined or misspelt values ('YU/BD', 'YUS', 'SRT', ...): when comparing lines, use WHERE line IN ('YU', 'BD', 'SHP').
  There is no passenger count, cost or weather information.
  vehicle   INTEGER

pet_names  -- Licensed Dog and Cat Names: only the top 200 names per animal per year, so it can't give total pet counts
  animal          VARCHAR  -- 'DOG' or 'CAT'
  year            INTEGER  -- 2020 to 2026
  rank            INTEGER  -- 1 = most popular that year
  name            VARCHAR  -- upper case, e.g. 'LUNA'
  licensed_count  INTEGER  -- licensed animals with that name that year`

const PLAN_SYSTEM = `You help non-technical people get answers from three City of Toronto open datasets. You write DuckDB SQL; the queries run elsewhere and you never see the data at this step.

${SCHEMA}

Always answer by calling the reply tool (never plain text), in one of these two shapes.

If the question can be answered (even partly) from these tables:
{"answerable": true, "datasets": ["ferry" | "subway_delays" | "pet_names", ...], "queries": [
  {"id": "q1", "purpose": "what this shows, one short phrase", "chart": "columns" | "bars", "unit": "riders" | "delays" | "minutes" | "dogs" | ..., "sql": "SELECT ... AS label, ... AS value FROM ..."}
]}

Rules for queries:
- 2 or 3 queries, each a different angle that helps answer the question. The first one answers it most directly.
- Each query returns EXACTLY two columns and ONE row per label (labels are unique): "label" (short readable text, e.g. strftime(ts, '%b') for months, 'Line 1' instead of 'YU', weekday names, years as text) and "value" (a number, rounded).
- At most ${MAX_ROWS} rows (use LIMIT). Rankings: ORDER BY value DESC. Time or ordered categories: chronological order.
- chart "columns" for time or ordered categories; "bars" for rankings with longer labels.
- Never chart a rank as the value (a bigger bar would mean a worse rank); chart licensed_count, delays, minutes or riders instead.
- To compare groups over time, write one query per group or pick the single most useful split; never return a third column.
- Only SELECT from the tables above. Standard DuckDB functions only.
- Averages per day/month/year are usually clearer than totals across uneven periods. Name the unit honestly ("riders per day", "delays per month").
- Before writing each query, check it actually measures what its purpose says.

If the question can't be answered from these tables (another topic, or data they don't contain):
{"answerable": false, "message": "one or two plain sentences saying what these datasets cover and why this question isn't covered", "suggestions": ["three short questions these tables CAN answer"]}`

const REPAIR_NOTE = `Some of your queries failed when run. Fix them and reply with the same shape, containing all queries (fixed ones and ones that worked).`

const WRITE_SYSTEM = `You turn query results into a short, plain-English data story for non-technical readers.

What the data is:
${SCHEMA}

You get the question and a numbered list of charts, each with its purpose, its SQL and its result rows (label, value).

Always answer by calling the reply tool (never plain text):
{"lead": "the direct answer in at most 9 words, e.g. \"Line 1 has the most delays.\"",
 "highlight": "the 1-3 most important words of lead, copied exactly, e.g. \"Line 1\"",
 "sub": "one short line on what data and period this is based on",
 "stat": {"value": "the single most telling number, formatted, e.g. 48% or 15,806", "caption": "what that number is, under 12 words"},
 "points": [{"h": "headline for this chart, at most 9 words", "p": "one short sentence about what this chart shows", "more": "one or two sentences with extra facts from this chart's rows"}],
 "next": ["three short follow-up questions"]}

Rules:
- "points" has exactly one entry per chart, in the same order, and every entry has all three fields filled in. Each point talks about its own chart.
- "sub" states the real period, taken from the SQL and rows and the data notes above.
- Every number you write must appear in the rows or be a simple calculation from them (sum, share, difference, ratio). Never invent numbers.
- Only describe what the numbers show. Never explain why (no causes, motives, tourism, weather, the pandemic as a reason, data quality, "limited data"), unless the rows themselves show it. Calling 2020 the pandemic year is fine.
- Only mention things that are in the rows. If a row looks odd or tiny, leave it out rather than comment on it.
- "next" questions must be answerable from these columns only: ferry riders by time (year, month, weekday, hour); subway delays by date, hour, weekday, station, cause, line and minutes; dog and cat names by year and rank. Nothing about routes, destinations, rider types, capacity, costs or weather.
- If the results don't really answer the question, say so plainly in "lead".
- pet_names counts licensed animals with a name in a year, not new registrations.
- Plain words, no jargon, no markdown. Write names in normal case (Luna, Kipling station), not upper case.`

export interface PlannedQuery {
  id: string
  purpose: string
  chart: 'columns' | 'bars'
  unit: string
  sql: string
}

export type Plan =
  | { answerable: true; datasets: string[]; queries: PlannedQuery[] }
  | { answerable: false; message: string; suggestions: string[] }

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
  sub: string
  stat: { value: string; caption: string }
  points: { h: string; p: string; more: string }[]
  next: string[]
}

// The reply comes back as a "reply" tool call, so the API hands us parsed
// JSON instead of us parsing text the model typed (SQL with quotes in it
// broke that). Newer models don't accept a forced tool_choice, so the prompt
// asks for the tool and plain-text JSON is the fallback.
async function callClaude(system: string, user: string, maxTokens: number, schema: Record<string, unknown>): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured on the server.')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
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
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['answerable'],
}

const WRITE_SCHEMA = {
  type: 'object',
  properties: {
    lead: { type: 'string' },
    highlight: { type: 'string' },
    sub: { type: 'string' },
    stat: { type: 'object', properties: { value: { type: 'string' }, caption: { type: 'string' } }, required: ['value', 'caption'] },
    points: {
      type: 'array',
      items: { type: 'object', properties: { h: { type: 'string' }, p: { type: 'string' }, more: { type: 'string' } }, required: ['h', 'p', 'more'] },
    },
    next: { type: 'array', items: { type: 'string' } },
  },
  required: ['lead', 'highlight', 'sub', 'stat', 'points', 'next'],
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function cleanPlan(raw: unknown): Plan {
  const r = (raw || {}) as Record<string, unknown>
  if (r.answerable === false) {
    return {
      answerable: false,
      message: str(r.message, 400) || "These datasets can't answer that question.",
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
  const datasets = (Array.isArray(r.datasets) ? r.datasets : []).map((d) => str(d, 20)).filter(Boolean)
  return { answerable: true, datasets, queries }
}

export async function planQueries(question: string, failed?: { sql: string; error: string }[], previous?: PlannedQuery[]): Promise<Plan> {
  let user = `Question: ${question}`
  if (failed?.length && previous?.length) {
    user += `\n\nYour previous queries:\n${JSON.stringify(previous)}\n\n${REPAIR_NOTE}\n${failed
      .map((f) => `SQL: ${f.sql}\nError: ${f.error}`)
      .join('\n\n')}`
  }
  return cleanPlan(await callClaude(PLAN_SYSTEM, user, 1500, PLAN_SCHEMA))
}

export async function writeStory(question: string, results: QueryResult[]): Promise<Story> {
  const today = new Date().toISOString().slice(0, 10)
  const charts = results.map(({ purpose, sql, unit, rows }, i) => `Chart ${i + 1}: ${purpose}\nUnit: ${unit}\nSQL: ${sql}\nRows: ${JSON.stringify(rows)}`)
  const user = `Today is ${today}.\nQuestion: ${question}\n\n${charts.join('\n\n')}\n\nWrite exactly ${results.length} points, one per chart.`
  const r = ((await callClaude(WRITE_SYSTEM, user, 1200, WRITE_SCHEMA)) || {}) as Record<string, unknown>
  const stat = (r.stat || {}) as Record<string, unknown>
  const points = (Array.isArray(r.points) ? r.points : []).slice(0, results.length).map((p) => {
    const o = (p || {}) as Record<string, unknown>
    return { h: str(o.h, 120), p: str(o.p, 300), more: str(o.more, 500) }
  })
  while (points.length < results.length) points.push({ h: results[points.length].purpose, p: '', more: '' })
  return {
    lead: str(r.lead, 160),
    highlight: str(r.highlight, 80),
    sub: str(r.sub, 200),
    stat: { value: str(stat.value, 24), caption: str(stat.caption, 140) },
    points,
    next: (Array.isArray(r.next) ? r.next : []).map((s) => str(s, 120)).filter(Boolean).slice(0, 3),
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

// A short-lived signed token ties the write step (and at most one query
// repair) to a plan step that was counted against the daily limit.
function secret() {
  return process.env.TORONTO_TOKEN_SECRET || process.env.ANTHROPIC_API_KEY || 'dev-only-secret'
}
function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}
export function issueToken(question: string): string {
  const exp = Date.now() + TOKEN_TTL_MS
  const nonce = Math.random().toString(36).slice(2, 10)
  return `${exp}.${nonce}.${sign(`${exp}.${nonce}.${question}`)}`
}

const spent = new Map<string, number>() // `${use}:${token}` -> expiry
export function useToken(token: unknown, question: string, use: 'write' | 'repair'): boolean {
  if (typeof token !== 'string') return false
  const [exp, nonce, sig] = token.split('.')
  if (!exp || !nonce || !sig || Number(exp) < Date.now()) return false
  const expected = Buffer.from(sign(`${exp}.${nonce}.${question}`))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
  const now = Date.now()
  if (spent.size > 5000) for (const [k, e] of spent) if (e < now) spent.delete(k)
  const key = `${use}:${token}`
  if (spent.has(key)) return false
  spent.set(key, Number(exp))
  return true
}
