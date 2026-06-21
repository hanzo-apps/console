'use client'

/**
 * Auth gate — renders children only for a signed-in account.
 *
 * While the session loads, shows a spinner. With no account, redirects to
 * `/signin`. Used to wrap the authenticated dashboard.
 */
import { useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner, XStack } from '@hanzo/gui'

import { useSession } from '~/lib/auth/session'

export function AuthGate({ children }: { children: ReactNode }) {
  const { account, loading } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !account) router.replace('/signin')
  }, [loading, account, router])

  if (loading || !account) {
    return (
      <XStack flex={1} minH="100vh" items="center" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  return <>{children}</>
}
