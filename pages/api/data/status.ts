import type { NextApiRequest, NextApiResponse } from 'next'
import { status } from '../../../lib/ask/guard'
import { isAdmin } from '../../../lib/ask/http'

// This month's AI spend and today's question count, for the cost check-ins.
// Admin only (header x-ask-admin: ASK_ADMIN_TOKEN).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAdmin(req)) return res.status(404).json({ error: 'Not found' })
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json(await status())
}
