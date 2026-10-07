import type { NextApiRequest, NextApiResponse } from 'next'
import { clientIp } from '../../../lib/rateLimit'
import { cacheGet, cachePut, checkAndCount } from '../../../lib/ask/guard'
import { MAX_QUESTION_LENGTH, Story, cleanResults, storyKey, useToken, writeStory } from '../../../lib/ask/engine'
import { isAdmin, log, REFUSAL_STATUS } from '../../../lib/ask/http'
import { getPortal } from '../../../lib/ask/portals'

export const config = { maxDuration: 30 }

// Step 2 of a live question: the AI writes the story from the query results
// the browser computed. Needs the signed token from a /api/data/plan call. A
// story already written for the same question and the same result rows comes
// from the cache; if the plan came from the cache (so wasn't counted) and the
// story isn't cached, this is the step that counts against the limits.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const ip = clientIp(req)
  const { portal: slug, question: q, token, results: raw } = req.body || {}
  const portal = getPortal(slug)
  if (!portal || !portal.live) return res.status(404).json({ error: 'Unknown portal.' })
  const question = typeof q === 'string' ? q.trim() : ''
  if (!question || question.length > MAX_QUESTION_LENGTH) return res.status(400).json({ error: 'Invalid question.' })
  const results = cleanResults(raw)
  if (!results) return res.status(400).json({ error: 'Invalid results.' })
  const t = useToken(token, portal.slug, question, 'write')
  if (!t) return res.status(403).json({ error: 'This question has expired. Please ask it again.' })

  const key = storyKey(portal, question, results)
  const cached = req.body?.refresh && isAdmin(req) ? null : await cacheGet<Story>(key)
  if (cached) {
    log('ask_write_cached', { portal: portal.slug, ip, question })
    return res.status(200).json({ ...cached, cached: true })
  }
  if (!t.counted && !isAdmin(req)) {
    const refusal = await checkAndCount(ip)
    if (refusal) {
      log('ask_refused', { portal: portal.slug, ip, refusal, step: 'write' })
      return res.status(REFUSAL_STATUS).json({ error: refusal })
    }
  }

  const startedAt = Date.now()
  try {
    const story = await writeStory(portal, question, results)
    await cachePut(key, story)
    log('ask_write_ok', { portal: portal.slug, ip, question, queries: results.length, durationMs: Date.now() - startedAt })
    return res.status(200).json(story)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    log('ask_write_error', { portal: portal.slug, ip, question, error: message, durationMs: Date.now() - startedAt })
    return res.status(502).json({ error: 'Could not write the story. Please try again.' })
  }
}
