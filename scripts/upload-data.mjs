// Uploads a portal's parquet files to Vercel Blob, so they're served from
// object storage instead of the git repo and the deployment.
//
//   BLOB_READ_WRITE_TOKEN=... node scripts/upload-data.mjs <slug>
//
// Files go to data/<slug>/<snapshot>/<table>.parquet: a new snapshot gets new
// URLs, so browsers never mix cached files from two snapshots. Then set the
// printed URL as "data.remote" in portals/<slug>/portal.json. "data.base"
// stays the local build path that portal-data.mjs and precompute.mjs use.
// The token comes from the Blob store in the Vercel dashboard (Storage).
import fs from 'node:fs'
import path from 'node:path'
import { put } from '@vercel/blob'

const slug = process.argv[2]
if (!slug) { console.error('Usage: BLOB_READ_WRITE_TOKEN=... node scripts/upload-data.mjs <slug>'); process.exit(1) }
if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error('BLOB_READ_WRITE_TOKEN is not set'); process.exit(1) }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const portal = JSON.parse(fs.readFileSync(path.join(root, 'portals', slug, 'portal.json'), 'utf8'))
const dir = path.join(root, 'public', portal.data.base)
const tables = portal.datasets.flatMap((d) => d.tables)
const prefix = `data/${slug}/${portal.data.snapshot}/`

let base = ''
for (const t of tables) {
  const file = path.join(dir, `${t}.parquet`)
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: run scripts/portal-data.mjs ${slug} first`)
  const blob = await put(prefix + `${t}.parquet`, fs.readFileSync(file), {
    access: 'public', addRandomSuffix: false, allowOverwrite: true,
    contentType: 'application/vnd.apache.parquet', cacheControlMaxAge: 365 * 24 * 3600,
  })
  base = blob.url.slice(0, blob.url.length - `${t}.parquet`.length)
  console.log(`${t}: ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`)
}
// Browsers fetch these from the portal's page on another origin, so they need CORS.
const res = await fetch(`${base}${tables[0]}.parquet`, { method: 'HEAD', headers: { origin: 'https://search.portaljs.com' } })
console.log(`\nSet in portals/${slug}/portal.json:  "data": { ..., "remote": "${base}" }`)
console.log(`CORS check: ${res.status}, access-control-allow-origin = ${res.headers.get('access-control-allow-origin') || 'MISSING (the page will not be able to load the files)'}`)
