// Builds a portal's data from its catalogue: downloads the source files, turns
// each table into a parquet file, and writes a profile that flags the usual
// traps, as a starting point for notes.md.
//
//   node scripts/portal-data.mjs <slug> [--only <table>] [--no-download]
//
// Reads portals/<slug>/sources.json:
//   {
//     "type": "ckan" | "datapackage",
//     "api": "https://<ckan>/api/3/action",          (ckan only)
//     "tables": {
//       "<table>": {
//         "dataset": "<ckan dataset name> | <datapackage URL, e.g. https://datahub.io/core/gdp>",
//         "resource": "<resource name>" | ["<name>", ...] | "*",   several are stacked by column name
//         "inputs": { "<view>": { "dataset": ..., "resource": ... } },  optional extra inputs, e.g. code lists
//         "sql": "SELECT ... FROM raw"     optional DuckDB transform; the default renames columns to snake_case
//         "read": { "names": [...], "delim": "," }   optional read_csv options for awkward files; "names" replaces a header that doesn't match the rows
//       }
//     }
//   }
// Writes public/<data.base>/<table>.parquet, portals/<slug>/profile.md, and
// portals/<slug>/notes.md if it doesn't exist yet. Downloads are cached in
// .cache/portals/<slug>/. Needs the duckdb CLI and python3.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const slug = args[0]
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const download = !args.includes('--no-download')
if (!slug) { console.error('Usage: node scripts/portal-data.mjs <slug> [--only <table>] [--no-download]'); process.exit(1) }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const pdir = path.join(root, 'portals', slug)
const sources = JSON.parse(fs.readFileSync(path.join(pdir, 'sources.json'), 'utf8'))
const portal = JSON.parse(fs.readFileSync(path.join(pdir, 'portal.json'), 'utf8'))
if (!portal.data.base.startsWith('/')) throw new Error('data.base points to remote storage; build locally to a public/ path first, then upload')
const outDir = path.join(root, 'public', portal.data.base)
const cacheDir = path.join(root, '.cache/portals', slug)
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(cacheDir, { recursive: true })

const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const duck = (sql) => { const out = sh('duckdb', ['-json', '-c', sql]); return out.trim() ? JSON.parse(out) : [] }
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`
const snake = (s) => String(s).normalize('NFKD').replace(/[^\w\s]/g, ' ').trim().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/\s+/g, '_').toLowerCase() || 'col'
const safeName = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 80)
async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}
async function fetchTo(url, file) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

// Rewrites a CSV with Python's csv module: one record per line, no stray
// carriage returns inside fields, invalid UTF-8 replaced. DuckDB's sniffer
// gives up on several catalogues' raw dumps; it reads the cleaned files fine.
function cleanCsv(src, dest, skipHeader = false) {
  sh('python3', ['-c', `
import csv, sys
csv.field_size_limit(10**9)
src, dest, skip = sys.argv[1], sys.argv[2], sys.argv[3] == '1'
with open(src, newline='', encoding='utf-8-sig', errors='replace') as fi, open(dest, 'a' if skip else 'w', newline='', encoding='utf-8') as fo:
    r = csv.reader(fi); w = csv.writer(fo, lineterminator='\\n')
    for i, row in enumerate(r):
        if skip and i == 0: continue
        w.writerow([c.replace('\\r', ' ').replace('\\n', ' ') for c in row])
`, src, dest, skipHeader ? '1' : '0'])
}

// ---- catalogue adapters: each returns the cleaned CSV files for one input ----

const ckanMeta = {}
async function ckanFiles(spec, key) {
  const pkg = (ckanMeta[spec.dataset] ||= (await getJson(`${sources.api}/package_show?id=${encodeURIComponent(spec.dataset)}`)).result)
  const want = spec.resource === '*' ? null : [].concat(spec.resource)
  const resources = pkg.resources.filter((r) => (want ? want.includes(r.name) : r.datastore_active))
  if (want) for (const n of want) if (!resources.some((r) => r.name === n)) throw new Error(`${spec.dataset}: no resource named "${n}" (have: ${pkg.resources.map((r) => r.name).join(' | ')})`)
  const files = []
  for (const [i, r] of resources.entries()) {
    const dest = path.join(cacheDir, `${key}.${i}.csv`)
    files.push(dest)
    if (!download && fs.existsSync(dest)) continue
    if (r.datastore_active) {
      // Datastore dumps are silently capped (512,000 rows on Toronto's), so page through them.
      const base = sources.api.replace(/\/api\/3\/action\/?$/, '')
      const page = 100000
      for (let off = 0; ; off += page) {
        const part = path.join(cacheDir, `${key}.${i}.part.csv`)
        await fetchTo(`${base}/datastore/dump/${r.id}?offset=${off}&limit=${page}`, part)
        cleanCsv(part, dest, off > 0)
        const lines = Number(sh('python3', ['-c', 'import csv,sys; csv.field_size_limit(10**9); print(sum(1 for _ in csv.reader(open(sys.argv[1], newline="", encoding="utf-8", errors="replace"))))', part]).trim())
        fs.rmSync(part)
        if (lines - 1 < page) break
      }
    } else {
      const raw = path.join(cacheDir, `${key}.${i}.raw`)
      await fetchTo(r.url, raw)
      let csvPath = raw
      if (/\.zip$/i.test(r.url) || String(r.format).toUpperCase() === 'ZIP') {
        const unz = path.join(cacheDir, `${key}.${i}.unzip`)
        fs.rmSync(unz, { recursive: true, force: true })
        sh('unzip', ['-q', '-o', raw, '-d', unz])
        const found = sh('find', [unz, '-iname', '*.csv']).trim().split('\n').filter(Boolean)
        if (found.length !== 1) throw new Error(`${spec.dataset} / ${r.name}: expected one CSV in the zip, found ${found.length}`)
        csvPath = found[0]
      }
      cleanCsv(csvPath, dest)
    }
    console.log(`  downloaded ${spec.dataset} / ${r.name}`)
  }
  return { files, title: pkg.title, url: null, descriptions: {} }
}

const dpMeta = {}
async function datapackageFiles(spec, key) {
  const base = spec.dataset.replace(/\/datapackage\.json$/, '').replace(/\/$/, '')
  // Resource paths are relative to where datapackage.json actually lives (DataHub redirects to its file store).
  const dp = (dpMeta[base] ||= await (async () => {
    const res = await fetch(`${base}/datapackage.json`)
    if (!res.ok) throw new Error(`${res.status} ${base}/datapackage.json`)
    return { ...(await res.json()), _url: res.url.replace(/datapackage\.json$/, '') }
  })())
  const want = spec.resource === '*' ? null : [].concat(spec.resource)
  const resources = dp.resources.filter((r) => (want ? want.includes(r.name) : /csv/i.test(r.format || r.path)))
  if (want) for (const n of want) if (!resources.some((r) => r.name === n)) throw new Error(`${base}: no resource named "${n}" (have: ${dp.resources.map((r) => r.name).join(' | ')})`)
  const files = []
  const descriptions = {}
  for (const [i, r] of resources.entries()) {
    const dest = path.join(cacheDir, `${key}.${i}.csv`)
    files.push(dest)
    for (const f of r.schema?.fields || []) if (f.description) descriptions[f.name] = f.description
    if (!download && fs.existsSync(dest)) continue
    const url = /^https?:/.test(r.path) ? r.path : new URL(r.path, dp._url).href
    const raw = path.join(cacheDir, `${key}.${i}.raw`)
    await fetchTo(url, raw)
    cleanCsv(raw, dest)
    console.log(`  downloaded ${base} / ${r.name}`)
  }
  return { files, title: dp.title, url: base, descriptions }
}

const adapters = { ckan: ckanFiles, datapackage: datapackageFiles }
if (!adapters[sources.type]) throw new Error(`sources.json type must be one of: ${Object.keys(adapters).join(', ')}`)

// ---- profile: what notes.md needs to say, and the traps to warn about ----

function profileTable(table, file, descriptions) {
  const t = `read_parquet(${q(file)})`
  const cols = duck(`DESCRIBE SELECT * FROM ${t}`)
  const [{ n }] = duck(`SELECT count(*) AS n FROM ${t}`)
  const dateCol = cols.find((c) => /^(DATE|TIMESTAMP)/.test(c.column_type))?.column_name
  const years = dateCol ? duck(`SELECT min(year(${ident(dateCol)})) AS lo, max(year(${ident(dateCol)})) AS hi FROM ${t}`)[0] : null
  const lines = [`### ${table}`, '', `${Number(n).toLocaleString('en-US')} rows, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`, '']
  const flags = []
  for (const c of cols) {
    const name = c.column_name, type = c.column_type, id = ident(name)
    const [s] = duck(`SELECT count(*) FILTER (WHERE ${id} IS NULL) AS nulls, approx_count_distinct(${id}) AS distinct FROM ${t}`)
    let detail = ''
    if (/INT|DOUBLE|DECIMAL|FLOAT|BIGINT|HUGEINT/.test(type)) {
      const [r] = duck(`SELECT min(${id}) AS lo, max(${id}) AS hi, round(avg(${id}), 2) AS avg FROM ${t}`)
      detail = `${r.lo} to ${r.hi}, average ${r.avg}`
      if ([-1, -9, -99, -999, -9999].includes(Number(r.lo))) flags.push(`${name}: minimum is ${r.lo}, probably a "no data" marker; filter it out`)
      if (Number(r.lo) === 0) {
        const [z] = duck(`SELECT count(*) FILTER (WHERE ${id} = 0) AS zeros, count(*) FILTER (WHERE ${id} > 0) AS pos FROM ${t}`)
        if (z.zeros && z.pos / (z.pos + z.zeros) > 0.9) flags.push(`${name}: ${z.zeros} values are exactly 0 among mostly positive ones; if 0 means "no value", use nullif(${name}, 0) in sources.json`)
      }
    } else if (/^(DATE|TIMESTAMP)/.test(type)) {
      const [r] = duck(`SELECT min(${id})::VARCHAR AS lo, max(${id})::VARCHAR AS hi FROM ${t}`)
      detail = `${r.lo} to ${r.hi}`
    } else if (type === 'VARCHAR' || type === 'BOOLEAN') {
      const top = duck(`SELECT ${id}::VARCHAR AS v, count(*) AS k FROM ${t} WHERE ${id} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT ${s.distinct <= 12 ? 12 : 6}`)
      detail = (s.distinct <= 12 ? 'values: ' : `${s.distinct.toLocaleString('en-US')} distinct, e.g. `) + top.map((r) => `'${String(r.v).slice(0, 50)}' (${r.k})`).join(', ')
      const [junk] = type !== 'VARCHAR' ? [{}] : duck(`SELECT count(*) FILTER (WHERE trim(${id}) IN ('None', 'NA', 'N/A', 'null', 'NULL', '-', '')) AS placeholders, count(*) FILTER (WHERE ${id} LIKE '%Ã%' OR ${id} LIKE '%â€%' OR ${id} LIKE '%' || chr(226) || chr(128) || '%') AS mojibake FROM ${t}`)
      if (junk.placeholders) flags.push(`${name}: ${junk.placeholders} values are text like 'None' or 'NA' instead of empty; use nullif() in sources.json`)
      if (junk.mojibake) flags.push(`${name}: ${junk.mojibake} values have garbled characters (mojibake); fix in sources.json`)
      // Categories that appear or vanish partway through: renamed categories break trends.
      if (dateCol && years && years.hi - years.lo >= 2 && s.distinct >= 3 && s.distinct <= 3000) {
        const span = duck(`SELECT ${id}::VARCHAR AS v, min(year(${ident(dateCol)})) AS first, max(year(${ident(dateCol)})) AS last, count(*) AS k FROM ${t} WHERE ${id} IS NOT NULL GROUP BY 1 HAVING count(*) >= ${Math.max(20, Math.round(n * 0.003))} ORDER BY k DESC LIMIT 200`)
        const late = span.filter((r) => r.first > years.lo + 1), gone = span.filter((r) => r.last < years.hi - 1)
        if (late.length + gone.length >= 3) flags.push(`${name}: ${gone.length} common values stop and ${late.length} start partway through (e.g. ${gone.slice(0, 2).map((r) => `'${r.v}' until ${r.last}`).concat(late.slice(0, 2).map((r) => `'${r.v}' from ${r.first}`)).join(', ')}): possibly renamed categories; check before comparing years`)
      }
    } else detail = ''
    const desc = descriptions[name] || descriptions[name.replace(/_/g, ' ')] || ''
    lines.push(`- \`${name}\` ${type}${s.nulls ? `, ${Math.round((s.nulls / n) * 100)}% empty` : ''}: ${detail}${desc ? `\n  - source says: ${desc.slice(0, 200)}` : ''}`)
  }
  if (years) {
    const months = duck(`SELECT year(${ident(dateCol)}) AS y, count(DISTINCT month(${ident(dateCol)})) AS m FROM ${t} GROUP BY 1 HAVING m < 12 ORDER BY 1`)
    if (months.length) flags.push(`${dateCol}: partial years ${months.map((r) => `${r.y} (${r.m} months)`).join(', ')}; leave them out of year-on-year comparisons`)
  }
  if (flags.length) lines.push('', '**Check:**', ...flags.map((f) => `- ${f}`))
  return { md: lines.join('\n'), cols, n, dateCol }
}

// ---- main ----

const profiles = []
const noteDrafts = []
for (const [table, spec] of Object.entries(sources.tables)) {
  if (only && table !== only) continue
  if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`Table name "${table}" must be lower-case letters, digits and underscores`)
  console.log(`table ${table}`)
  const inputs = { raw: spec, ...(spec.inputs || {}) }
  const views = []
  let meta = null
  for (const [view, ispec] of Object.entries(inputs)) {
    const got = await adapters[sources.type]({ dataset: ispec.dataset, resource: ispec.resource ?? '*' }, `${safeName(table)}.${safeName(view)}`)
    if (!got.files.length) throw new Error(`${table}: no files for input "${view}"`)
    if (view === 'raw') meta = got
    // "read" options are passed to read_csv; "names" replaces a header that doesn't match the rows.
    const { names, ...read } = ispec.read || {}
    let extra = names ? `, header = false, skip = 1, names = [${names.map(q).join(', ')}]` : ', union_by_name = true'
    for (const [k, v] of Object.entries(read)) extra += `, ${k.replace(/\W/g, '')} = ${typeof v === 'string' ? q(v) : JSON.stringify(v)}`
    views.push(`CREATE VIEW ${ident(view)} AS SELECT * FROM read_csv([${got.files.map(q).join(', ')}]${extra}, sample_size = 100000);`)
  }
  let select = spec.sql
  if (!select) {
    const cols = duck(`${views.join('\n')}\nDESCRIBE SELECT * FROM raw`).map((c) => c.column_name).filter((c) => c !== '_id')
    const seen = new Set()
    select = `SELECT ${cols.map((c) => { let s = snake(c); while (seen.has(s)) s += '_'; seen.add(s); return `${ident(c)} AS ${ident(s)}` }).join(', ')} FROM raw`
  }
  const file = path.join(outDir, `${table}.parquet`)
  try {
    sh('duckdb', ['-c', `${views.join('\n')}\nCOPY (${select}) TO ${q(file)} (FORMAT parquet, COMPRESSION zstd);`])
  } catch (e) {
    const cols = duck(`${views.join('\n')}\nDESCRIBE SELECT * FROM raw`).map((c) => `${c.column_name} ${c.column_type}`).join(', ')
    console.error(`\n${table}: the transform failed:\n  ${String(e.stderr || e.message).split('\n')[0]}\n  raw columns: ${cols}`)
    process.exit(1)
  }
  const prof = profileTable(table, file, meta.descriptions)
  profiles.push(prof.md)
  noteDrafts.push([
    `${table}  -- ${meta.title}. TODO: what one row is.`,
    ...prof.cols.map((c) => `  ${c.column_name.padEnd(18)} ${c.column_type.padEnd(10)} -- TODO`),
    '  Notes: TODO (how to count correctly, units, periods, traps from profile.md)',
  ].join('\n'))
  console.log(`  ${prof.n.toLocaleString('en-US')} rows -> ${path.relative(root, file)}`)
}

if (!only) {
  fs.writeFileSync(path.join(pdir, 'profile.md'), `# Data profile: ${portal.name}\n\nGenerated by scripts/portal-data.mjs on ${new Date().toISOString().slice(0, 10)}. Use it to write and check notes.md; items under **Check** need a decision.\n\n${profiles.join('\n\n')}\n`)
  const notes = path.join(pdir, 'notes.md')
  const draft = !fs.existsSync(notes)
  if (draft) fs.writeFileSync(notes, `Tables (DuckDB). Snapshot downloaded from ${portal.source.label || portal.source.name} on ${new Date().toISOString().slice(0, 10)}.\n\n${noteDrafts.join('\n\n')}\n`)
  console.log(`wrote portals/${slug}/profile.md${draft ? ' and a notes.md draft' : ''}`)
}
