import fs from 'fs'
import path from 'path'
import type { NextApiRequest, NextApiResponse } from 'next'
import { cacheGet } from '../../lib/ask/guard'
import { MAX_QUESTION_LENGTH, normQuestion, shareKey } from '../../lib/ask/engine'
import { getPortal, Share } from '../../lib/ask/portals'

// A shared answer's address (/?q=... or /demo/<slug>?q=..., see next.config.js).
// Serves the portal's normal page with the answer's headline and summary as the
// page title and link preview, so a link pasted in Slack, Teams or an email
// shows the answer. The page then shows the answer itself, as for any question.
// No AI here: the headline comes from the saved examples or from the cache of
// earlier live answers; otherwise the preview shows the question.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const plain = (s: string) => s.replace(/\*/g, '').replace(/\s+/g, ' ').trim()

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const portal = getPortal(req.query.portal)
  if (!portal) return res.status(404).send('Not found')
  let html: string
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'public/p', portal.slug, 'index.html'), 'utf8')
  } catch {
    return res.redirect(307, `/p/${portal.slug}/index.html`)
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, MAX_QUESTION_LENGTH) : ''
  if (q) {
    const saved: Share | null = portal.shares?.[normQuestion(q)] || (portal.live ? await cacheGet<Share>(shareKey(portal, q)) : null)
    const title = `${plain(saved?.lead || q)} · ${portal.name}`
    const description = saved?.summary ? plain(saved.summary) : `${q}${/[?.!]$/.test(q) ? "" : "?"} Answered from ${portal.datasets.length} open datasets by ${portal.owner}.`
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(title)}"`)
      .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*"/g, `$1${esc(description)}"`)
  }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
  return res.status(200).send(html)
}
