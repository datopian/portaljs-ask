import type { NextApiRequest } from 'next'

export function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }))
}

// Requests carrying ASK_ADMIN_TOKEN skip the daily limits (not the monthly
// budget's spend tracking): used by scripts/precompute.mjs to fill the
// examples' instant answers.
export function isAdmin(req: NextApiRequest): boolean {
  const want = process.env.ASK_ADMIN_TOKEN
  return !!want && req.headers['x-ask-admin'] === want
}

export const REFUSAL_STATUS = 429
