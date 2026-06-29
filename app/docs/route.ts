/**
 * `/docs` → the brand documentation site (new origin), server-side redirect.
 *
 * Docs are an EXTERNAL product on their own domain (docs.hanzo.ai / docs.lux.network
 * / …), never an in-app route — so a typed or bookmarked `console.<brand>/docs`
 * must land on the real docs, not the catch-all `notFound()` (the old 404). The
 * brand is resolved from the request Host so a lux/zoo console redirects to ITS
 * docs. The sidebar "Docs" entry and the header "?" open the same URL in a new tab;
 * this handler only covers the direct-navigation case.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { resolveConfig } from '~/config'

export const runtime = 'nodejs'

export function GET(req: NextRequest) {
  const host = req.headers.get('host')
  return NextResponse.redirect(resolveConfig(host ?? undefined).docsUrl, 308)
}
