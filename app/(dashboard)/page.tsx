'use client'

/**
 * The console home.
 *
 * THREE things happen before the board renders, and each one is load-bearing:
 *
 *  1. A product-shell face (billing.<brand>, sentry.<brand>, platform.<brand>, …)
 *     has its OWN home, so the default route redirects there. Someone who only ever
 *     sees billing.hanzo.ai should land on billing, not on this board.
 *
 *  2. The static embed serves THIS page's index.html for EVERY deep link — the
 *     export cannot pre-generate arbitrary product slugs. So a direct load or a
 *     refresh of /billing, /models, /agents … arrives here, and this page must
 *     resolve the live path and hand it to the shared `ProductRoute`. Without that
 *     hand-off every deep link in production renders the home board instead of its
 *     product, which is exactly what happened when this file was first rewritten.
 *     `mounted` gates it so the first client render matches the server-exported
 *     home and there is no hydration mismatch.
 *
 *  3. Only then, at the real root, the board itself — see src/components/home/Home.tsx
 *     for why it is the account's own state rather than a catalog of every product.
 *
 * On a real Next server this page only ever renders for "/", so `segments` is empty
 * and step 2 is inert. It exists for the export, where it is the whole routing story.
 */
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Spinner, XStack } from '@hanzo/gui'

import { config } from '~/config'
import { shellFor } from '~/lib/products/shell'
import { ProductRoute } from '~/components/ProductRoute'
import { Home } from '~/components/home/Home'

export default function DashboardHome() {
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const shellHome = shellFor(config.shell).home
  useEffect(() => {
    if (shellHome) router.replace(`/${shellHome}`)
  }, [router, shellHome])

  const segments =
    mounted && pathname ? pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean) : []
  // ANY address but the root belongs to the renderer, including one that resolves to
  // nothing: it answers "no such page". This used to fall through to the board when
  // the address was unknown, which is why a wrong link and a typo both rendered the
  // home screen and neither said so.
  if (segments.length > 0) return <ProductRoute slug={segments} />

  if (shellHome) {
    return (
      <XStack flex={1} justify="center" items="center" p="$8">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }

  return <Home />
}
