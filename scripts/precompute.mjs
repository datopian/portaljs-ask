// Pre-computes instant answers for a portal's example questions, so clicking an
// example costs nothing and shows immediately. Each question goes through the
// real pipeline: the deployed API plans the queries, they run here with the
// DuckDB CLI on the portal's parquet files (exactly as the browser would), and
// the API writes the story. Results go to portals/<slug>/instant.json; review
// the printed answers before committing.
//
//   ASK_ADMIN_TOKEN=... node scripts/precompute.mjs <slug> --api https://<deployment> [--only "question"] [--force | --restory]
//
// Needs the `duckdb` CLI. ASK_ADMIN_TOKEN (same value as on the deployment)
// lets these requests skip the daily limits; their AI cost still counts towards
// the monthly budget. Existing answers are kept unless --force, which also
// bypasses the server's answer cache. --restory keeps each saved answer's queries
// and rows (already checked) and only has the story written again, e.g. after
// the story format changes. Highlighted numbers that don't appear in the rows
// are printed with "?": check those by hand (they can be fair calculations).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const slug = args[0]
const opt = (name) => { const i = args.indexOf(name); return i > 0 ? args[i + 1] : undefined }
const api = (opt('--api') || '').replace(/\/$/, '')
const only = opt('--only')
const force = args.includes('--force')
const restory = args.includes('--restory')
if (!slug || !api) {
  console.error('Usage: node scripts/precompute.mjs <slug> --api https://<deployment> [--only "question"] [--force | --restory]')
  process.exit(1)
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const pdir = path.join(root, 'portals', slug)
const portal = JSON.parse(fs.readFileSync(path.join(pdir, 'portal.json'), 'utf8'))
const instantFile = path.join(pdir, 'instant.json')
const instant = fs.existsSync(instantFile) ? JSON.parse(fs.readFileSync(instantFile, 'utf8')) : []
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const tables = portal.datasets.flatMap((d) => d.tables)
const base = portal.data.base.startsWith('/') ? path.join(root, 'public', portal.data.base) : portal.data.base

async function post(endpoint, body) {
  const res = await fetch(`${api}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ask-admin': process.env.ASK_ADMIN_TOKEN || '' },
    body: JSON.stringify({ portal: slug, ...(force ? { refresh: true } : {}), ...body }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${json.error || 'failed'}`)
  return json
}

// Same wrapping and checks as runQuery() in engine/ask.html.
function runQuery(sql) {
  const used = tables.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(sql))
  const views = used.map((t) => `CREATE VIEW ${t} AS SELECT * FROM '${base}${t}.parquet';`).join('\n')
  const inner = sql.trim().replace(/;+\s*$/, '')
  const out = execFileSync('duckdb', ['-json', '-c', `${views}\nSELECT CAST(label AS VARCHAR) AS label, CAST(value AS DOUBLE) AS value FROM (${inner}) AS q LIMIT 30;`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const rows = (out.trim() ? JSON.parse(out) : []).filter((r) => r.value !== null && Number.isFinite(Number(r.value))).map((r) => ({ label: String(r.label ?? ''), value: Number(r.value) }))
  if (new Set(rows.map((r) => r.label)).size < rows.length) throw new Error('Each label must appear only once: return exactly two columns (label, value) and one row per label.')
  return rows
}

// Numbers the story highlights (**x** and the facts) that no row value matches, at the usual scales and roundings.
function unmatched(story, queries) {
  const values = queries.flatMap((q) => q.rows.map((r) => r.value))
  const said = [...(story.summary || '').matchAll(/\*\*([^*]+)\*\*/g), ...story.points.flatMap((p) => [...(p.p || '').matchAll(/\*\*([^*]+)\*\*/g)])].map((m) => m[1])
    .concat((story.facts || []).map((f) => f.value))
  const near = (a, b) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.006)
  return said.filter((t) => {
    const m = t.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
    if (!m) return false // words like "four times"
    let n = Number(m[0])
    const scale = /trillion/i.test(t) ? 1e12 : /billion|bn\b/i.test(t) ? 1e9 : /million|\dM\b/i.test(t) ? 1e6 : /\d\s*(k|thousand)\b/i.test(t) ? 1e3 : 1
    return !values.some((v) => [1, scale].some((s) => near(n * s, v) || near(n, v / s) || near(n, Math.round(v / s)))) && !(/^(1[89]|20)\d\d$/.test(m[0]))
  })
}

const runAll = (queries) => queries.map((q) => {
  try { return { q, rows: runQuery(q.sql) } } catch (e) { return { q, error: String(e.stderr || e.message || e).slice(0, 400) } }
})

for (const question of portal.examples) {
  if (only && norm(only) !== norm(question)) continue
  const have = instant.findIndex((a) => norm(a.q) === norm(question))
  if (restory && have < 0) { console.log(`! ${question}: no saved answer to rewrite`); continue }
  if (have >= 0 && !force && !restory) { console.log(`= ${question} (kept)`); continue }
  try {
    if (restory) {
      // The plan call only issues the token the write step needs; it is normally an answer-cache hit.
      const plan = await post('/api/data/plan', { question })
      const old = instant[have]
      const results = old.queries.map(({ id, purpose, sql, unit, rows }) => ({ id, purpose, sql, unit, rows }))
      const story = await post('/api/data/write', { question, token: plan.token, results })
      delete story.cached
      instant[have] = { ...old, story, created: new Date().toISOString().slice(0, 10) }
      fs.writeFileSync(instantFile, JSON.stringify(instant, null, 1) + '\n')
      const odd = unmatched(story, old.queries)
      console.log(`+ ${question}\n  ${story.lead}\n  ${story.summary}\n  S: ${(story.sources || []).join(' | ')}\n  ${story.facts.map((f) => `${f.value} ${f.label}`).join(' | ')}${odd.length ? `\n  ? ${odd.join(' | ')}` : ''}`)
      continue
    }
    let plan = await post('/api/data/plan', { question })
    if (!plan.answerable) { console.log(`! ${question}: not answerable: ${plan.message}`); continue }
    let ran = runAll(plan.queries)
    const failed = ran.filter((r) => r.error)
    if (failed.length) {
      const fixed = await post('/api/data/plan', { question, repair: { token: plan.token, previous: plan.queries, failed: failed.map((r) => ({ sql: r.q.sql, error: r.error })) } })
      if (fixed.answerable) { plan = { ...fixed, token: plan.token }; ran = runAll(plan.queries) }
    }
    const ok = ran.filter((r) => !r.error && r.rows.length)
    if (!ok.length) { console.log(`! ${question}: no query returned rows`); continue }
    const results = ok.map(({ q, rows }) => ({ id: q.id, purpose: q.purpose, sql: q.sql, unit: q.unit, rows }))
    const story = await post('/api/data/write', { question, token: plan.token, results })
    delete story.cached
    const answer = { q: question, queries: ok.map(({ q, rows }) => ({ id: q.id, purpose: q.purpose, chart: q.chart, unit: q.unit, sql: q.sql, rows })), story, created: new Date().toISOString().slice(0, 10) }
    if (have >= 0) instant[have] = answer
    else instant.push(answer)
    fs.writeFileSync(instantFile, JSON.stringify(instant, null, 1) + '\n')
    const odd = unmatched(story, answer.queries)
    console.log(`+ ${question}\n  ${story.lead}\n  ${story.summary}${odd.length ? `\n  ? ${odd.join(' | ')}` : ''}`)
  } catch (e) {
    console.log(`! ${question}: ${e.message}`)
  }
}
