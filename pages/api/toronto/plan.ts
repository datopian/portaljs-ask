import type { NextApiRequest, NextApiResponse } from 'next'
import { checkRateLimit, clientIp } from '../../../lib/rateLimit'
import { MAX_QUESTION_LENGTH, MAX_QUERIES, PlannedQuery, issueToken, planQueries, useToken } from '../../../lib/toronto'

export const config = { maxDuration: 30 }

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }))
}

// Step 1 of a live Toronto question (see lib/toronto.ts): the model picks the
// datasets and writes the SQL. This is the step counted against the daily
// limit. A request carrying `repair` re-plans failed queries for a question
// already counted, once per token.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const ip = clientIp(req)
  const { question: q, repair } = req.body || {}
  const question = typeof q === 'string' ? q.trim() : ''
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ error: `Ask a question of up to ${MAX_QUESTION_LENGTH} characters.` })
  }

  let failed: { sql: string; error: string }[] | undefined
  let previous: PlannedQuery[] | undefined
  let token: string
  if (repair) {
    if (!useToken(repair.token, question, 'repair')) return res.status(403).json({ error: 'This question has expired. Please ask it again.' })
    failed = (Array.isArray(repair.failed) ? repair.failed : [])
      .slice(0, MAX_QUERIES)
      .map((f: { sql?: unknown; error?: unknown }) => ({ sql: String(f?.sql ?? '').slice(0, 3000), error: String(f?.error ?? '').slice(0, 500) }))
    previous = (Array.isArray(repair.previous) ? repair.previous : []).slice(0, MAX_QUERIES)
    token = repair.token
  } else {
    const rateLimit = checkRateLimit(ip, 'toronto')
    res.setHeader('X-RateLimit-Limit', String(rateLimit.limit))
    res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining))
    if (!rateLimit.allowed) {
      log('toronto_rate_limited', { ip, questionLength: question.length })
      return res.status(429).json({ error: 'limit', limit: rateLimit.limit })
    }
    token = issueToken(question)
  }

  const startedAt = Date.now()
  try {
    const plan = await planQueries(question, failed, previous)
    log('toronto_plan_ok', { ip, repair: !!repair, answerable: plan.answerable, question, durationMs: Date.now() - startedAt })
    return res.status(200).json({ ...plan, token })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    log('toronto_plan_error', { ip, repair: !!repair, question, error: message, durationMs: Date.now() - startedAt })
    return res.status(502).json({ error: 'Could not work out how to answer that. Please try again.' })
  }
}
