'use client'

/**
 * The ONE admin read: `{ data, loading, err }` + a reload, over any `/v1/admin`
 * fetcher. Every admin board repeated this block verbatim; it lives here now.
 *
 * The fetcher is the dependency — pass a `useCallback` and the read re-runs when its
 * inputs change (a range tab, a selected org), so there is no second "reload on
 * change" path. A failed read KEEPS the last good data and surfaces an `ApiError`;
 * the caller decides between the 403 operator panel and the honest error card.
 */
import { useCallback, useEffect, useState } from 'react'

import type { ApiError } from '~/lib/api'
import { asApiError } from '~/components/ui/States'

export function useAdminResource<T>(fetcher: () => Promise<T>): {
  data: T | null
  loading: boolean
  err: ApiError | null
  reload: () => Promise<void>
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      setData(await fetcher())
    } catch (e) {
      setErr(asApiError(e))
    } finally {
      setLoading(false)
    }
  }, [fetcher])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, err, reload }
}
