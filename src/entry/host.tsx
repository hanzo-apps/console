'use client'

/**
 * Console's answer to the two questions a shared state card cannot answer for
 * itself: how do I sign in again (401), and where do I add credits (402)?
 *
 * `@hanzo/ui/product` is presentational — `BackendStateCard` never imports a
 * router or an auth module, it asks its host. Console answers ONCE, here, and
 * every card below renders the right affordance with nothing passed down. Answer
 * in one place or answer in 106 call sites; this is the one place.
 */
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { startReauth } from '~/lib/auth/iam'
import { HostProvider } from '@hanzo/ui/product'

export function Host({ children }: { children: ReactNode }) {
  const router = useRouter()
  return (
    <HostProvider actions={{ signIn: startReauth, addCredits: () => router.push('/billing/credits') }}>
      {children}
    </HostProvider>
  )
}
