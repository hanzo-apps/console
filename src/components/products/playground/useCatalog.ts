'use client'

/**
 * useCatalog — load the live model catalog ONCE for the playground.
 *
 * This is the SAME source the Models page uses (`CloudModelApi.list()` → the
 * `/v1/models` proxy + best-effort `/v1/pricing/models` overlay), so the
 * selectable models and their $/Mtok pricing are exactly what the catalog shows.
 * Every playground surface (compare board, embeddings, audio, vision) shares this
 * one hook — one fetch, one honest loading/error state, no duplicate catalogs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { CloudModelApi, type CatalogModel } from '~/lib/api'
import { classifyBackend, type BackendState } from '@hanzo/ui/product'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; models: CatalogModel[] }

export type Catalog = {
  phase: State['phase']
  models: CatalogModel[]
  error: BackendState | null
  byId: Map<string, CatalogModel>
  ids: string[]
  reload: () => void
}

export function useCatalog(): Catalog {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const reload = useCallback(() => {
    setState({ phase: 'loading' })
    CloudModelApi.list()
      .then((models) => setState({ phase: 'ready', models }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => reload(), [reload])

  const models = state.phase === 'ready' ? state.models : []
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models])
  const ids = useMemo(() => models.map((m) => m.id), [models])

  return { phase: state.phase, models, error: state.phase === 'error' ? state.error : null, byId, ids, reload }
}

/**
 * Pick up to `n` distinct default models, preferring Hanzo's Zen models first
 * (the gateway default), then filling from the rest of the catalog.
 */
export function defaultModels(ids: string[], n: number): string[] {
  const zen = ids.filter((x) => /zen/i.test(x))
  const ordered = [...zen, ...ids.filter((x) => !/zen/i.test(x))]
  const out: string[] = []
  for (const id of ordered) {
    if (!out.includes(id)) out.push(id)
    if (out.length >= n) break
  }
  return out
}
