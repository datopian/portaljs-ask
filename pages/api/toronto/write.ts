import type { NextApiRequest, NextApiResponse } from 'next'
import { clientIp } from '../../../lib/rateLimit'
import { MAX_QUESTION_LENGTH, cleanResults, useToken, writeStory } from '../../../lib/toronto'

export const config = { maxDuration: 30 }

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }))
}

// Step 2 of a live Toronto question: the model writes the story from the
// query results the browser computed. Only reachable once per question,
// with the signed token from a /api/toronto/plan call that was already
// counted against the daily limit.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const ip = clientIp(req)
  const { question: q, token, results: raw } = req.body || {}
  const question = typeof q === 'string' ? q.trim() : ''
  if (!question || question.length > MAX_QUESTION_LENGTH) return res.status(400).json({ error: 'Invalid question.' })
  const results = cleanResults(raw)
  if (!results) return res.status(400).json({ error: 'Invalid results.' })
  if (!useToken(token, question, 'write')) return res.status(403).json({ error: 'This question has expired. Please ask it again.' })

  const startedAt = Date.now()
  try {
    const story = await writeStory(question, results)
    log('toronto_write_ok', { ip, question, queries: results.length, durationMs: Date.now() - startedAt })
    return res.status(200).json(story)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    log('toronto_write_error', { ip, question, error: message, durationMs: Date.now() - startedAt })
    return res.status(502).json({ error: 'Could not write the story. Please try again.' })
  }
}
