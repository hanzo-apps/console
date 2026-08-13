'use client'

/**
 * Next's own 404 boundary — the answer for a path no route file claims (a stray
 * segment under one of the non-catch-all trees, e.g. /keys/x/y).
 *
 * Product addresses never arrive here: they resolve through the catch-all and, when
 * they resolve to nothing, `ProductRoute` renders the SAME surface inside the shell,
 * where the sidebar is the way out. Both entry points say the same thing because
 * both render `NotFound`; this one has no shell to keep, so it centres it.
 */
import { usePathname } from 'next/navigation'
import { YStack } from '@hanzo/gui'

import { NotFound } from '~/components/NotFound'

export default function RouteNotFound() {
  const pathname = usePathname() ?? ''
  return (
    <YStack flex={1} minH="100vh" p="$4" gap="$4" maxW={880} self="center" width="100%">
      <NotFound slug={pathname.split('/').filter(Boolean)} />
    </YStack>
  )
}
