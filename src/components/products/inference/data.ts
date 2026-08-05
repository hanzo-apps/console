'use client'

/**
 * The ONE data hook behind the Inference dashboard + its Status/Logs sub-pages.
 * Fetches the two REAL endpoint sources (the managed model-serving catalog and the
 * org's own deployed KServe InferenceServices) and the REAL usage ledger, in parallel,
 * and folds them into the shared view-models. Honest by construction:
 *  - the managed catalog is the populated base; the deployed source is best-effort
 *    (a 403/404 when ML isn't routed just omits those rows — never an error card while
 *    the catalog carries the page);
 *  - an error surfaces ONLY when BOTH endpoint sources fail (nothing real to show);
 *  - the ledger is optional (`hasLedger`) — when it isn't routed, per-endpoint request
 *    metrics render an honest "—" instead of a fabricated number.
 */
import { useCallback, useEffect, useState } from 'react'

import { CloudModelApi } from '~/lib/api/models-catalog'
import { InferenceApi } from '~/lib/api/inference'
import { fetchUsageRecords, type UsageRecord } from '~/lib/api/aimetrics'
import { fromCatalogModel, fromMlEndpoint, mergeEndpoints, type Endpoint } from './logic'
import { classifyRead, type BackendState } from '@hanzo/ui/product'

export type InferenceData = {
  endpoints: Endpoint[]
  records: UsageRecord[]
  /** True when the usage ledger loaded (its per-endpoint metrics are real, not "—"). */
  hasLedger: boolean
  loading: boolean
  /** Set ONLY when both real endpoint sources fail — an honest backend state. */
  error: BackendState | null
  reload: () => void
}

export function useInferenceData(): InferenceData {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [hasLedger, setHasLedger] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const [cat, dep, led] = await Promise.allSettled([
      CloudModelApi.list(),
      InferenceApi.listEndpoints(),
      fetchUsageRecords(),
    ])
    const managed = cat.status === 'fulfilled' ? cat.value.map(fromCatalogModel) : []
    const deployed = dep.status === 'fulfilled' ? dep.value.map(fromMlEndpoint) : []
    setEndpoints(mergeEndpoints(managed, deployed))

    if (led.status === 'fulfilled') {
      setRecords(led.value)
      setHasLedger(true)
    } else {
      setRecords([])
      setHasLedger(false)
    }

    // An error card shows ONLY when BOTH endpoint sources failed (the page genuinely
    // has nothing real to render). If either succeeded, we show what we have — a
    // failed deployed-source (ML not routed) is expected and never an error.
    if (cat.status === 'rejected' && dep.status === 'rejected') {
      setError(classifyRead(cat.reason) ?? classifyRead(dep.reason) ?? { kind: 'error', message: 'Could not load endpoints' })
    } else {
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { endpoints, records, hasLedger, loading, error, reload }
}
