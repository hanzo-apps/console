'use client'

/**
 * The deploy board's ONE read: the org's container apps and its static sites,
 * folded into a single `DeployRow` list.
 *
 * Two independent backends answer here (`/v1/platform/projects/:p/apps` and
 * `/v1/platform/sites`), so they are read with `allSettled` and reported
 * separately. A partial read stays a partial read: the rows that loaded render,
 * and `partial` names the half that did not. Collapsing that into one error would
 * hide working data; collapsing it into silence would show a short list as if it
 * were the whole truth. Only when BOTH fail is there nothing honest to draw, and
 * then `error` carries the state card.
 *
 * Org scoping is the bearer proxy's job on the server side. This hook sends no
 * org and filters by none.
 */
import { useCallback, useEffect, useState } from 'react'

import { PaasApi } from '~/lib/api/paas'
import { PlatformSitesApi } from '~/lib/api/platform-sites'
import { byRecency, rowOfApp, rowOfSite, type DeployRow } from '~/lib/deploy/board'
import { interpretPlatformError, type PlatformError } from '../platform/state'

export type Board = {
  rows: DeployRow[]
  loading: boolean
  /** Set only when BOTH sources failed — there is nothing truthful to render. */
  error: PlatformError | null
  /** Set when exactly one source failed — the rows shown are incomplete, and say so. */
  partial: string | null
  reload: () => Promise<void>
}

export function useBoard(): Board {
  const [rows, setRows] = useState<DeployRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<PlatformError | null>(null)
  const [partial, setPartial] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [apps, sites] = await Promise.allSettled([PaasApi.listAllApps(), PlatformSitesApi.list()])

    const next: DeployRow[] = []
    if (apps.status === 'fulfilled') next.push(...apps.value.map(rowOfApp))
    if (sites.status === 'fulfilled') next.push(...sites.value.map(rowOfSite))
    setRows(byRecency(next))

    if (apps.status === 'rejected' && sites.status === 'rejected') {
      setError(interpretPlatformError(apps.reason))
      setPartial(null)
    } else {
      setError(null)
      setPartial(
        apps.status === 'rejected'
          ? 'Apps could not be loaded — sites only.'
          : sites.status === 'rejected'
            ? 'Sites could not be loaded — apps only.'
            : null,
      )
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { rows, loading, error, partial, reload: load }
}
