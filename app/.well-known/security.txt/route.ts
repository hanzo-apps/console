/**
 * /.well-known/security.txt — RFC 9116.
 *
 * A route, not a file in public/, because ONE image serves six brands. The host
 * decides which (`brandFromHost`), and a static file cannot tell console.hanzo.ai
 * from console.lux.cloud — it would publish a Hanzo address on a Lux and a Zoo
 * console, which is the one thing a white-label surface must never do.
 *
 * So a brand that has not stated its own reporting address gets what it serves
 * today: nothing. 404 rather than someone else's contact details.
 *
 * `Policy` points at hanzo.ai/security, which is where the organization's
 * disclosure policy already lives. The console is a dashboard; a second copy of
 * that prose here is a second copy to keep true.
 */
import { NextResponse } from 'next/server'

import { brandFromHost } from '~/config'

// The answer depends on the request's Host header, so it cannot be prerendered.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // Raw header on purpose: `brandFromHost` runs the fleet's own host
  // normalization (case, port, trailing dot). Normalizing again here would be a
  // second normalizer to keep in step with it.
  const host = request.headers.get('host') ?? ''
  if (brandFromHost(host) !== 'hanzo') {
    return new NextResponse(null, { status: 404 })
  }

  const body = [
    '# Hanzo AI — how to report a security problem.',
    '#',
    '# RFC 9116. Machine-readable on purpose: scanners and researchers look here',
    '# first, and a site without this file gets reported to whatever address someone',
    '# can guess, or not at all.',
    '',
    'Contact: mailto:security@hanzo.ai',
    'Expires: 2027-08-01T00:00:00.000Z',
    'Preferred-Languages: en',
    `Canonical: https://${host}/.well-known/security.txt`,
    'Policy: https://hanzo.ai/security',
    '',
  ].join('\n')

  return new NextResponse(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
