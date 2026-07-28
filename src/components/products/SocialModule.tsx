'use client'

/**
 * Social — the console's mount of the ONE social surface. The whole product (compose,
 * schedule, list + calendar, publish, connect, honest states) is `SocialResource` in
 * `@hanzo/ui/product/social`; this is the console half of the seam, and all it does is hand
 * that component the console's bound `/v1/social` client.
 *
 * It used to be a 600-line copy of the product. Nothing but the transport differs
 * between hosts, so the copy was pure drift risk: the dedicated social.hanzo.ai app
 * renders the SAME component with its own binding.
 *
 * This is the host→mode twin of Billing: on social.hanzo.ai (config.socialOnly) the
 * console boots straight into this product. Every read/write is org-scoped by the
 * Bearer owner claim SERVER-SIDE.
 */
import { SocialResource } from '@hanzo/ui/product/social'

import { SocialApi } from '~/lib/api/social'

export function SocialModule(_props: { params: Record<string, string> }) {
  return <SocialResource api={SocialApi} />
}
