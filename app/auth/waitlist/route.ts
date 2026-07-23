/**
 * GET /auth/waitlist — the signed-in user's WAITLIST ACCESS + position (BFF).
 *
 * THE shared product-access check. The console shell (Waitlist) reads this to
 * decide whether to render the product or the waitlist status page; hanzo.chat and
 * hanzo.app gate on the SAME underlying `/v1/waitlist/status` for the same user, so
 * a user's access + position are identical across every surface.
 *
 * Resolves the caller's email from their established session (never trusts a
 * client-supplied email), then asks the waitlist plugin. FAIL-OPEN: when the waitlist
 * is unconfigured or unreachable, `waitlistAccess` grants access — the gate is
 * additive and never locks a signed-in user out of a paid product on a blip.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveUser } from '~/lib/server/identity'
import { waitlistAccess } from '~/lib/server/waitlist'

export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await resolveUser(req)
  if (!user) return NextResponse.json({ error: 'not authenticated' }, { status: 401 })

  // No email on the identity → cannot key a waitlist entry; fail OPEN (don't strand
  // a valid session behind a gate it can never satisfy).
  if (!user.email) return NextResponse.json({ hasAccess: true, status: null })

  const { hasAccess, status } = await waitlistAccess(user.email, req.headers.get('host'))
  return NextResponse.json({ hasAccess, status })
}
