import type { NextApiRequest, NextApiResponse } from 'next'
import { clientIp } from '../../../lib/rateLimit'
import { cacheGet, cachePut, checkAndCount } from '../../../lib/ask/guard'
import { MAX_QUERIES, MAX_QUESTION_LENGTH, Plan, PlannedQuery, issueToken, planKey, planQueries, searchCatalogue, useToken } from '../../../lib/ask/engine'
import { isAdmin, log, REFUSAL_STATUS } from '../../../lib/ask/http'
import { getPortal } from '../../../lib/ask/portals'

export const config = { maxDuration: 30 }

// Step 1 of a live question (see lib/ask/engine.ts): the AI picks the tables
// and writes the SQL. A question asked before on the same data comes from the
// cache and costs nothing; anything else counts against the limits in
// lib/ask/guard.ts. A request carrying `repair` re-plans failed queries for a
// question already counted, once per token.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const ip = clientIp(req)
  const { portal: slug, question: q, repair } = req.body || {}
  const portal = getPortal(slug)
  if (!portal || !portal.live) return res.status(404).json({ error: 'Unknown portal.' })
  const question = typeof q === 'string' ? q.trim() : ''
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ error: `Ask a question of up to ${MAX_QUESTION_LENGTH} characters.` })
  }
  const key = planKey(portal, question)
  const reply = async (plan: Plan, token: string, cached: boolean) => {
    if (plan.answerable) return res.status(200).json({ ...plan, token, cached })
    const related = await searchCatalogue(portal, plan.search || question)
    return res.status(200).json({ ...plan, related, token, cached })
  }

  let failed: { sql: string; error: string }[] | undefined
  let previous: PlannedQuery[] | undefined
  let token: string
  if (repair) {
    if (!useToken(repair.token, portal.slug, question, 'repair')) return res.status(403).json({ error: 'This question has expired. Please ask it again.' })
    failed = (Array.isArray(repair.failed) ? repair.failed : [])
      .slice(0, MAX_QUERIES)
      .map((f: { sql?: unknown; error?: unknown }) => ({ sql: String(f?.sql ?? '').slice(0, 3000), error: String(f?.error ?? '').slice(0, 500) }))
    previous = (Array.isArray(repair.previous) ? repair.previous : []).slice(0, MAX_QUERIES)
    token = repair.token
  } else {
    const cached = req.body?.refresh && isAdmin(req) ? null : await cacheGet<Plan>(key)
    if (cached) {
      log('ask_plan_cached', { portal: portal.slug, ip, question })
      return reply(cached, issueToken(portal.slug, question, false), true)
    }
    if (!isAdmin(req)) {
      const refusal = await checkAndCount(ip)
      if (refusal) {
        log('ask_refused', { portal: portal.slug, ip, refusal, questionLength: question.length })
        return res.status(REFUSAL_STATUS).json({ error: refusal })
      }
    }
    token = issueToken(portal.slug, question, true)
  }

  const startedAt = Date.now()
  try {
    const plan = await planQueries(portal, question, failed, previous)
    // Only plans the server got from the AI are cached (a repaired plan replaces the one that failed).
    await cachePut(key, plan)
    log('ask_plan_ok', { portal: portal.slug, ip, repair: !!repair, answerable: plan.answerable, question, durationMs: Date.now() - startedAt })
    return reply(plan, token, false)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    log('ask_plan_error', { portal: portal.slug, ip, repair: !!repair, question, error: message, durationMs: Date.now() - startedAt })
    return res.status(502).json({ error: 'Could not work out how to answer that. Please try again.' })
  }
}
