// Bundles every portals/<slug>/ folder for the app (runs before `next dev` and `next build`):
//   - lib/ask/portals.generated.json: all portals' settings + AI data notes, for the API
//   - public/p/<slug>/index.html: the branded page, from engine/ask.html
// Both outputs are generated, not committed. See ARCHITECTURE.md.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const dir = path.join(root, 'portals')
const { default: defaultSlug } = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))
const template = fs.readFileSync(path.join(root, 'engine/ask.html'), 'utf8')

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// "Line one.|Line *two.*": | is a line break, *x* is the highlighted word.
const headline = (s) => esc(s).split('|').join('<br>').replace(/\*([^*]+)\*/g, '<em>$1</em>')
const REQUIRED = ['slug', 'name', 'owner', 'description', 'headline', 'intro', 'source', 'catalogue', 'data', 'datasets', 'examples']

const portals = {}
for (const slug of fs.readdirSync(dir).sort()) {
  const pdir = path.join(dir, slug)
  if (!fs.statSync(pdir).isDirectory()) continue
  const portal = JSON.parse(fs.readFileSync(path.join(pdir, 'portal.json'), 'utf8'))
  const missing = REQUIRED.filter((k) => portal[k] == null)
  if (missing.length) throw new Error(`portals/${slug}/portal.json is missing: ${missing.join(', ')}`)
  if (portal.slug !== slug) throw new Error(`portals/${slug}/portal.json has slug "${portal.slug}"`)
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Portal slug "${slug}" must be lower-case letters, digits and dashes`)
  portal.notes = fs.readFileSync(path.join(pdir, 'notes.md'), 'utf8')
  const instantFile = path.join(pdir, 'instant.json')
  const instant = fs.existsSync(instantFile) ? JSON.parse(fs.readFileSync(instantFile, 'utf8')) : []
  portals[slug] = portal

  const out = path.join(root, 'public/p', slug)
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  let logo = ''
  if (portal.logo) {
    fs.copyFileSync(path.join(pdir, portal.logo), path.join(out, path.basename(portal.logo)))
    logo = `<img src="/p/${slug}/${esc(path.basename(portal.logo))}" alt="">`
  }
  const t = portal.theme || {}
  const vars = [['--blue', t.accent], ['--navy', t.navy], ['--gold', t.highlight], ['--ink', t.ink]].filter(([, v]) => v)
  const themeCss = vars.length ? `<style>@media not (prefers-color-scheme: dark) { :root { ${vars.map(([k, v]) => `${k}: ${v};`).join(' ')} } }</style>` : ''
  const src = portal.source
  const isDefault = slug === defaultSlug
  const footer = [
    isDefault ? `<p class="other-demos">Looking for the earlier demos? <a href="/security">Security advisories search</a> · <a href="/governance">Data governance search</a></p>` : '',
    `Built with PortalJS by Datopian. Data: ${esc(portal.owner)}, ${esc(src.name)}${src.licence ? `, ${esc(src.licence)}` : ''}.`,
    portal.live
      ? ` The first example questions were answered in advance. Other questions about the ${portal.datasets.length} connected datasets are answered live: AI writes the queries, they run on the data in your browser, and AI writes the story from their results. Every number comes from the query shown under its chart. Live questions are limited each day.`
      : ` The example questions were answered in advance by AI: it wrote the queries and the story, and every number comes from the query shown under its chart.`,
  ].join('')
  const pub = { slug, name: portal.name, live: portal.live !== false, examples: portal.examples, datasets: portal.datasets, data: portal.data, instant }
  const vals = {
    title: esc(portal.name), description: esc(portal.description), favicon: '', themeCss, logo, name: esc(portal.name),
    sourceUrl: esc(src.url), sourceName: esc(src.name), sourceLabel: esc(src.label || src.name),
    datasetCount: `${portal.datasets.length} dataset${portal.datasets.length === 1 ? '' : 's'}`,
    headline: headline(portal.headline), intro: esc(portal.intro), placeholder: esc(portal.placeholder || ''),
    formHidden: portal.live === false ? ' hidden' : '', footer,
    portalJson: JSON.stringify(pub).replace(/</g, '\\u003c'),
  }
  const html = template.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in vals)) throw new Error(`engine/ask.html uses unknown placeholder ${m}`)
    return vals[k]
  })
  fs.writeFileSync(path.join(out, 'index.html'), html)
  console.log(`portal ${slug}: ${portal.datasets.length} datasets, ${instant.length} instant answers${isDefault ? ' (default, served at /)' : ''}`)
}
if (!portals[defaultSlug]) throw new Error(`portals/index.json default "${defaultSlug}" has no folder`)
fs.writeFileSync(path.join(root, 'lib/ask/portals.generated.json'), JSON.stringify({ default: defaultSlug, portals }))
