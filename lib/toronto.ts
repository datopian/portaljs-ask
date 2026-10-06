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

const SCHEMA = `Tables (DuckDB). Snapshot downloaded from open.toronto.ca on 4-5 Oct 2026. Wards are Toronto's 25 city wards.

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
  licensed_count  INTEGER  -- licensed animals with that name that year

fire_incidents  -- Fire Incidents: fires Toronto Fire Services attended, one row per fire, 2011-2024
  alarm_time             TIMESTAMP
  incident_type          VARCHAR  -- '01 - Fire', '02 - Explosion ...', '03 - NO LOSS OUTDOOR fire ...'. Outdoor no-loss fires (03) are only recorded from 2018,
                                  -- so for trends across years use WHERE incident_type LIKE '01%'.
  initial_call           VARCHAR  -- what the 911 call said, e.g. 'Vehicle Fire', 'Fire - Residential'
  property_use           VARCHAR  -- coded text, e.g. '323 - Multi-Unit Dwelling - Over 12 Units', '301 - Detached Dwelling', '901 - Automobile'
  ward                   INTEGER  -- 1 to 25
  possible_cause         VARCHAR  -- e.g. '52 - Electrical Failure', '45 - Improperly Discarded', '44 - Unattended', '99 - Undetermined'
  ignition_source, material_first_ignited, area_of_origin, extent_of_fire, building_status  VARCHAR (coded text like the above)
  civilian_casualties, firefighter_casualties, persons_rescued, persons_displaced, responding_personnel  INTEGER
  dollar_loss            BIGINT   -- estimated dollar loss
  response_minutes       DOUBLE   -- alarm to first truck arriving
  smoke_alarm            VARCHAR  -- e.g. '2 - Floor/suite of fire origin: Smoke alarm present and operated', '1 - ...: No smoke alarm'
  sprinkler              VARCHAR
  Labels: strip the code numbers for display, e.g. regexp_replace(possible_cause, '^[0-9]+ - ', '').

fire_calls  -- Fire Services Emergency Incident Basic Detail: EVERY call Toronto Fire responded to (medical, fire, alarms, rescues ...), one row per call, 2018-2024
  alarm_time        TIMESTAMP
  call_type         VARCHAR  -- 'Medical', 'Emergency Fire', 'Vehicle Incident', 'Other Emergency Events', 'Technical Rescue', 'Carbon Monoxide', 'CBRN & Hazardous Materials', 'Non Emergency'
  event_type        VARCHAR  -- more detail, e.g. 'FAHR - Alarm Highrise Residential', 'REE - Rescue - Elevator', 'FIG - Fire - Grass/Rubbish'
  final_type        VARCHAR  -- what it turned out to be, coded text
  call_source       VARCHAR
  alarm_level       VARCHAR
  ward              INTEGER  -- 1 to 25 (0 = unknown)
  response_minutes  DOUBLE   -- alarm to first truck arriving
  persons_rescued   INTEGER

bus_delays  -- TTC Bus Delay Data, one row per incident, 2025-01-01 to 2026-08-31
  date DATE, time TIME, weekday VARCHAR ('Monday' ...),
  route     VARCHAR  -- upper case route, e.g. '52 LAWRENCE WEST', '32 EGLINTON WEST'
  location  VARCHAR  -- where it happened, upper case free text
  code VARCHAR, cause VARCHAR  -- upper-case description, e.g. 'NO OPERATOR AVAILABLE', 'ON DIVERSION', 'OTHER'; NULL for unknown codes
  min_delay INTEGER  -- minutes. Count a "delay" only WHERE min_delay > 0.
  min_gap INTEGER, bound VARCHAR

streetcar_delays  -- TTC Streetcar Delay Data, same columns as bus_delays, 2025-01-01 to 2026-08-31
  route e.g. '504 KING', '501 QUEEN', '505 DUNDAS', '506 CARLTON', '510 SPADINA'

shelter_occupancy  -- Daily Shelter & Overnight Service Occupancy & Capacity: one row per shelter program per night, 2021-01-01 to 2026-10-04
  date            DATE
  organization, shelter_group, location, program  VARCHAR
  sector          VARCHAR  -- 'Families', 'Mixed Adult', 'Men', 'Women', 'Youth'
  program_model   VARCHAR  -- 'Emergency', 'Transitional'
  service_type    VARCHAR  -- 'Shelter', 'Motel/Hotel Shelter', '24-Hour Respite Site', ...
  program_area    VARCHAR  -- 'Base Shelter and Overnight Services System', 'COVID-19 Response', 'Temporary Refugee Response', 'Winter Programs', ...
  capacity_type   VARCHAR  -- 'Bed Based Capacity' or 'Room Based Capacity' (families are usually counted in rooms)
  service_users   INTEGER  -- people staying that night
  beds_available, beds_occupied, rooms_available, rooms_occupied  INTEGER (NULL when the other capacity type applies)
  Notes: people in shelters on a night = sum(service_users) for that date. For a month or year, average the nightly totals:
    SELECT avg(n) FROM (SELECT date, sum(service_users) AS n FROM shelter_occupancy GROUP BY 1). 2026 is a partial year.

dinesafe  -- DineSafe restaurant and food premises inspections, one row per infraction (or one row for an inspection with none), 2023-11 to 2026-10
  establishment_id VARCHAR, establishment VARCHAR (upper case name), address VARCHAR
  inspection_date  DATE
  status           VARCHAR  -- 'Pass', 'Conditional Pass', 'Closed'
  infraction       VARCHAR  -- detailed text, NULL if none
  infraction_category VARCHAR
  severity         VARCHAR  -- 'M - Minor', 'S - Significant', 'C - Crucial', NULL if none
  outcome          VARCHAR  -- e.g. 'Conviction - Fined', mostly NULL
  fine             BIGINT   -- dollars, mostly NULL
  Notes: count inspections as count(DISTINCT establishment_id || inspection_date::VARCHAR), establishments as count(DISTINCT establishment_id).

marriage_licences  -- Marriage Licence Statistics: licences issued per month per civic centre, 2011-01 to 2026-06
  month DATE (first of the month), civic_centre VARCHAR ('TO' = Toronto City Hall, 'NY' = North York, 'SC' = Scarborough, 'ET' = Etobicoke), licences INTEGER

beach_water  -- Toronto Beaches Water Quality: E. coli samples, swimming season (May to September), 2007-2026
  beach VARCHAR (e.g. 'Woodbine Beaches', 'Cherry Beach', 'Kew Balmy Beach'), site VARCHAR (sampling point), date DATE
  ecoli BIGINT  -- E. coli per 100 mL; NULL if not sampled. Several sites per beach per day: average them per beach and day first.
  The City posts a beach as unsafe for swimming when E. coli is above 100.

short_term_rentals  -- Short-term rental registrations (Airbnb-style), current snapshot of registered operators
  property_type VARCHAR ('Condominium', 'Single/Semi-detached House', 'Apartment', 'Townhouse/ Row House', 'Duplex/Triplex/Fourplex'), ward INTEGER, ward_name VARCHAR, postal_code VARCHAR (first 3 characters)

apartment_evaluations  -- RentSafeTO apartment building evaluations (buildings with 3+ storeys and 10+ units), one row per evaluation, 2023-06 to 2026-10
  address VARCHAR, ward INTEGER, ward_name VARCHAR, property_type VARCHAR ('PRIVATE', 'TCHC' = Toronto Community Housing, 'SOCIAL HOUSING'),
  year_built INTEGER, year_evaluated INTEGER, evaluation_date DATE, storeys INTEGER, units INTEGER,
  score DOUBLE  -- 0 to 100, higher is better. A building can be evaluated more than once: for "per building", take its latest evaluation.

ksi_collisions  -- Motor vehicle collisions where someone was killed or seriously injured (KSI), 2006 to 2026-09
  ONE ROW PER PERSON INVOLVED, not per collision. Count collisions with count(DISTINCT collision_id).
  collision_id VARCHAR, collision_time TIMESTAMP
  severity  VARCHAR  -- for the whole collision: 'Fatal Injury', 'Non-Fatal Injury'
  injury    VARCHAR  -- for this person: 'Fatal', 'Major', 'Minor', 'Minimal', 'None'. People killed = count(*) WHERE injury = 'Fatal'.
  road_user VARCHAR  -- 'driver', 'pedestrian', 'passenger', 'cyclist', 'motorcyclist', ...
  age INTEGER, impact_type, light, road_condition, visibility, road_class VARCHAR
  ward_name, neighbourhood, street1, street2 VARCHAR
  pedestrian, cyclist, motorcyclist, aggressive, distracted, red_light, school_child, older_adult, heavy_truck  BOOLEAN  -- collision involved this
  2026 is a partial year.

homeless_deaths_month  -- Deaths of people experiencing homelessness, by month, 2022-2024
  year INTEGER, month VARCHAR ('January' ...), deaths INTEGER
homeless_deaths_cause  -- the same deaths by cause, age group and gender, 2022-2024
  year INTEGER, cause VARCHAR ('Acute Drug Toxicity', 'Cardiovascular Disease', 'Suicide', 'Homicide', 'Unknown', 'Pending', ...),
  age_group VARCHAR ('<20', '20-39', '40-59', '60+', 'Unknown'), gender VARCHAR, deaths INTEGER

library_visits  -- Toronto Public Library visits per branch per year, 2012-2024
  year INTEGER, branch VARCHAR (e.g. 'Toronto Reference Library', 'North York Central Library'), visits BIGINT

street_trees  -- every City-owned tree on a street, current inventory, 688,335 trees
  ward INTEGER, common_name VARCHAR (e.g. 'Maple, Norway', 'Honey locust', 'Oak, red'), botanical_name VARCHAR, trunk_diameter_cm INTEGER, street VARCHAR

building_permits  -- Building permits cleared (closed or finished) since 2017, one row per permit
  permit_type VARCHAR ('Plumbing(PS)', 'Small Residential Projects', 'Mechanical(MS)', 'New Houses', 'Demolition Folder (DM)', ...),
  structure_type, work ('Interior Alterations', 'New Building', ...), status ('Closed', 'Cancelled', ...)  VARCHAR,
  application_date, issued_date, completed_date DATE  -- use issued_date for trends, 2017-2025 are the full years
  current_use, proposed_use VARCHAR, units_created, units_lost INTEGER (dwelling units), est_cost DOUBLE (dollars), postal_area VARCHAR

animal_services  -- Toronto Animal Services service requests and complaints, 2023-2026 (2026 partial)
  year INTEGER, category VARCHAR ('MOBILE RESPONSE SERVICE REQUESTS', 'ENFORCEMENT COMPLAINTS'),
  request_type VARCHAR (upper case, e.g. 'INJURED WILDLIFE', 'CADAVER - WILDLIFE', 'COYOT RESPONSE' = coyote, 'NOISE', 'STRAY DOG RUNNING AT LARGE')

service_requests_311  -- 311 service requests, already COUNTED per day: one row per date + ward + type + status, 2019-01-01 to 2026-08-31
  date DATE, ward VARCHAR (e.g. 'Toronto-Danforth (14)'), division VARCHAR ('Solid Waste Management Services', 'Transportation Services', 'Municipal Licensing & Standards', 'Toronto Water', 'Urban Forestry', ...),
  section VARCHAR, request_type VARCHAR (e.g. 'Road - Pot hole', 'Res / Garbage / Not Picked Up', 'Property Standards', 'Injured - Wildlife', 'Noise'), status VARCHAR,
  requests INTEGER  -- ALWAYS use sum(requests), never count(*).`

const PLAN_SYSTEM = `You help non-technical people get answers from twenty City of Toronto open datasets (the tables below). You write DuckDB SQL; the queries run elsewhere and you never see the data at this step.

${SCHEMA}

Always answer by calling the reply tool (never plain text), in one of these two shapes.

If the question can be answered (even partly) from these tables:
{"answerable": true, "datasets": ["table names used", ...], "queries": [
  {"id": "q1", "purpose": "what this shows, one short phrase", "chart": "columns" | "bars", "unit": "riders" | "delays" | "minutes" | "dogs" | ..., "sql": "SELECT ... AS label, ... AS value FROM ..."}
]}

Rules for queries:
- 2 or 3 queries, each a different angle that helps answer the question. The first one answers it most directly.
- Each query returns EXACTLY two columns and ONE row per label (labels are unique): "label" (short readable text, e.g. strftime(ts, '%b') for months, 'Line 1' instead of 'YU', weekday names, years as text) and "value" (a number, rounded).
- At most ${MAX_ROWS} rows (use LIMIT). Rankings: ORDER BY value DESC. Time or ordered categories: chronological order.
- chart "columns" for time or ordered categories; "bars" for rankings with longer labels.
- Never chart a rank as the value (a bigger bar would mean a worse rank); chart the underlying count instead.
- To compare groups over time, write one query per group or pick the single most useful split; never return a third column.
- Only SELECT from the tables above. Standard DuckDB functions only.
- Averages per day/month/year are usually clearer than totals across uneven periods. Name the unit honestly ("riders per day", "delays per month").
- Before writing each query, check it actually measures what its purpose says.

If the question can't be answered from these tables (another topic, or data they don't contain):
{"answerable": false, "message": "one plain sentence saying this isn't in the datasets connected here", "search": "2-4 keywords to search the full Toronto Open Data catalogue for it, e.g. parking tickets", "suggestions": ["three short questions these tables CAN answer, close to what was asked"]}`

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
- "next" questions must be answerable from the columns listed above (any of the tables). Never suggest things the tables don't have, such as ferry routes, passenger counts, costs or weather.
- If the results don't really answer the question, say so plainly in "lead".
- pet_names counts licensed animals with a name in a year, not new registrations. ksi_collisions has one row per person: say people or collisions to match the SQL.
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
      // The system prompt (dataset descriptions) is the same on every call, so cache it.
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

// For questions the connected tables can't answer: search the full Toronto
// Open Data catalogue (CKAN, no AI involved) so the reply can point to the
// datasets that do exist on the portal.
const CKAN = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_search'
// Datasets already connected as tables above; never offered as "not connected yet".
const CONNECTED = new Set([
  'toronto-island-ferry-ticket-counts', 'ttc-subway-delay-data', 'licensed-dog-and-cat-names', 'fire-incidents',
  'fire-services-emergency-incident-basic-detail', 'ttc-bus-delay-data', 'ttc-streetcar-delay-data',
  'daily-shelter-overnight-service-occupancy-capacity', 'dinesafe', 'marriage-licence-statistics', 'toronto-beaches-water-quality',
  'short-term-rentals-registration', 'apartment-building-evaluation', 'motor-vehicle-collisions-involving-killed-or-seriously-injured-persons',
  'deaths-of-people-experiencing-homelessness', 'library-visits', 'street-tree-data', 'building-permits-cleared-permits',
  'toronto-animal-services-service-requests-complaints', '311-service-requests-customer-initiated',
])
export async function searchCatalogue(terms: string): Promise<CatalogueHit[]> {
  const q = terms.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().slice(0, 80)
  if (!q) return []
  try {
    const res = await fetch(`${CKAN}?${new URLSearchParams({ q, rows: '6' })}`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    const json = await res.json()
    const results: Record<string, unknown>[] = json?.result?.results || []
    return results
      .filter((d) => d.is_retired !== true && d.is_retired !== 'true' && !CONNECTED.has(String(d.name)))
      .slice(0, 3)
      .map((d) => ({
        title: str(d.title, 120),
        url: `https://open.toronto.ca/dataset/${encodeURIComponent(String(d.name || ''))}/`,
        note: str(String(d.excerpt || d.notes || '').replace(/\s+/g, ' '), 160),
      }))
      .filter((d) => d.title)
  } catch {
    return []
  }
}
