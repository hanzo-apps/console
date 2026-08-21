import { useCallback, useEffect, useState } from 'react'
import { originV1Url, restGet } from '~/lib/api/client'
import { interpretPlatformError, type PlatformError } from './platform/state'

/**
 * useResourceList — the ONE data seam for a networking/platform module that reads
 * a `/v1/<path>` collection into a table: `{ <key>: T[] }`.
 *
 * It folds the loading / error / rows boilerplate every module was hand-rolling
 * into one composable hook over the canonical REST client (`restGet` +
 * `originV1Url`, so every reader shares auth, no-store, and error shaping) and the
 * canonical `PlatformError` model (rendered by PlatformStateCard). A read NEVER
 * throws to the component — a failure degrades to an empty list plus a typed
 * `error`, so a page never blanks or error-toasts on load.
 *
 * @param path the `/v1` collection path, e.g. `'network/services'`
 * @param key  the array field in the response object, e.g. `'services'`
 */
export function useResourceList<T>(
  path: string,
  key: string,
): { rows: T[]; loading: boolean; error: PlatformError | null; reload: () => Promise<void> } {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<PlatformError | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const body = await restGet<Record<string, T[] | undefined>>(originV1Url(path))
      setRows(body[key] ?? [])
      setError(null)
    } catch (e) {
      setError(interpretPlatformError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [path, key])

  useEffect(() => {
    void reload()
  }, [reload])

  return { rows, loading, error, reload }
}
