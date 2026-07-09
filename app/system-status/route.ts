/**
 * /system-status — same-origin BFF for the global status badge.
 *
 * status.<brand> (Gatus) serves its JSON at `/api/v1/endpoints/statuses` with NO
 * CORS header, so the browser can't read it cross-origin. This route fetches it
 * SERVER-SIDE (no CORS) and returns a small overall summary the badge renders
 * natively — the console's established BFF pattern (no iframe, no third-party
 * script). Public health data only; no auth, no secrets.
 *
 * Fail-soft by construction: any upstream error (down/slow/garbage) returns
 * `overall: 'unknown'` with HTTP 200, so the badge shows a neutral state and the
 * shell never breaks.
 */
import { NextResponse } from 'next/server'

import { config } from '~/config'
import { fetchWithTimeout } from '~/lib/server/fetch-timeout'
import { summarizeStatuses, type StatusSummary } from '~/lib/status/summary'

// Health changes minute-to-minute — always evaluate fresh (short CDN cache below).
export const dynamic = 'force-dynamic'

const UNKNOWN: StatusSummary = { overall: 'unknown', total: 0, up: 0, down: [] }

export async function GET() {
  const statusUrl = config.statusUrl
  let summary = UNKNOWN
  try {
    const res = await fetchWithTimeout(
      `${statusUrl}/api/v1/endpoints/statuses`,
      { headers: { accept: 'application/json' }, cache: 'no-store' },
      { timeoutMs: 4000 },
    )
    if (res.ok) summary = summarizeStatuses(await res.json())
  } catch {
    // fail-soft → UNKNOWN
  }

  return NextResponse.json(
    { ...summary, statusUrl, checkedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, max-age=30' } },
  )
}
