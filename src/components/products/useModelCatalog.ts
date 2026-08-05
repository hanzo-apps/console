'use client'

/**
 * useModelCatalog — the ONE React hook that loads the live gateway model catalog
 * (`aicatalog.fetchCatalog`, through the authenticated `/ai` proxy so the user bearer
 * the gateway requires is attached server-side). Returns the RICH `CatalogEntry[]`
 * (name · provider · context · $/Mtok · availability · premium), which is exactly what
 * the unified `ModelSelector` groups by family. Honest loading/error state; an
 * unreachable catalog never invents rows — the catalog is the source of truth.
 *
 * This is the single fetch hook every model-SELECTION surface shares (Playground,
 * Evals). The playground's `useModels` builds its `ModelOption[]` view on top of this
 * so there is ONE catalog read, one loading/error state — no duplicate catalogs.
 */
import { useCallback, useEffect, useState } from 'react'

import { fetchCatalog, type CatalogEntry } from '~/lib/api/aicatalog'
import { classifyBackend, type BackendState } from '@hanzo/ui/product'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; entries: CatalogEntry[] }

export type ModelCatalog = {
  phase: State['phase']
  /** The rich catalog entries (source of truth for the selector's family grouping). */
  entries: CatalogEntry[]
  error: BackendState | null
  reload: () => void
}

export function useModelCatalog(): ModelCatalog {
  const [state, setState] = useState<State>({ phase: 'loading' })

  const reload = useCallback(() => {
    setState({ phase: 'loading' })
    fetchCatalog()
      .then((entries) => setState({ phase: 'ready', entries }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => reload(), [reload])

  return {
    phase: state.phase,
    entries: state.phase === 'ready' ? state.entries : [],
    error: state.phase === 'error' ? state.error : null,
    reload,
  }
}
