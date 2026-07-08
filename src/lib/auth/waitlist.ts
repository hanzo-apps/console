'use client'

/**
 * Client wire for the signed-in user's waitlist access + position.
 *
 * `useWaitlist()` fetches `/auth/waitlist` once the account is known and exposes
 * `{ hasAccess, status, loading, reload }`. FAIL-OPEN on a network/other error
 * (`hasAccess: true`) so a transient blip never traps a user on the gate — the
 * SERVER is the real access authority; this is UX.
 */
import { useCallback, useEffect, useState } from 'react'

export type WaitlistStatus = {
  hasAccess: boolean
  rank: number
  total: number
  aheadOf: number
  referralCount: number
  score: number
  boost: number
  refCode: string
  open: boolean
}

export type WaitlistView = { hasAccess: boolean; status: WaitlistStatus | null }

export async function fetchWaitlist(): Promise<WaitlistView> {
  try {
    const res = await fetch('/auth/waitlist', { credentials: 'include', cache: 'no-store' })
    if (!res.ok) return { hasAccess: true, status: null } // fail-open (UX)
    const j = (await res.json()) as WaitlistView
    return { hasAccess: j.hasAccess !== false, status: j.status ?? null }
  } catch {
    return { hasAccess: true, status: null }
  }
}

export function useWaitlist(enabled: boolean): {
  view: WaitlistView | null
  loading: boolean
  reload: () => void
} {
  const [view, setView] = useState<WaitlistView | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!enabled) {
      setView({ hasAccess: true, status: null })
      setLoading(false)
      return
    }
    setLoading(true)
    void fetchWaitlist().then((v) => {
      setView(v)
      setLoading(false)
    })
  }, [enabled])

  useEffect(() => {
    reload()
  }, [reload])

  return { view, loading, reload }
}
