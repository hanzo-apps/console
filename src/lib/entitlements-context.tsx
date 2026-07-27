'use client'

/**
 * Entitlements context — the ONE shared fetch of the active org's enabled products,
 * so the sidebar, command palette, and category pages all gate from a
 * single source (no duplicate requests, no drift).
 *
 * A super admin bypasses gating entirely (`enabled = null` = ungated → the whole
 * catalog). A customer's `enabled` is loaded from `EntitlementsApi.get(currentOrg())`;
 * until the endpoint lands (it 404s / errors) the set stays `null` = ungated, so the
 * console behaves exactly as today (zero regression). `addProducts`/`removeProducts`
 * POST the patch and update the set in place.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { useSession } from './auth/session'
import { useIsSuperAdmin } from './auth/admin'
import { currentOrg } from './org-scope'
import { EntitlementsApi, type EntitlementPatch } from './entitlements'

type EntitlementsState = {
  /** The org's enabled product ids, or `null` when UNGATED (super admin, or the
   *  endpoint hasn't landed / hasn't loaded — show everything). */
  enabled: string[] | null
  /** True once a real entitlement set is in force (a customer, endpoint answered). */
  gated: boolean
  loading: boolean
  refresh: () => Promise<void>
  addProducts: (ids: string[]) => Promise<void>
  removeProducts: (ids: string[]) => Promise<void>
}

const EntitlementsContext = createContext<EntitlementsState | null>(null)

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { account } = useSession()
  const isSuperAdmin = useIsSuperAdmin()
  const owner = account?.owner ?? ''

  const [enabled, setEnabled] = useState<string[] | null>(null)
  const [gated, setGated] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    // No account, or a super admin → ungated (bypass; the whole catalog shows).
    if (!owner || isSuperAdmin) {
      setEnabled(null)
      setGated(false)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await EntitlementsApi.get(currentOrg())
      setEnabled(res.enabled)
      setGated(true)
    } catch {
      // Endpoint not landed / unreachable → UNGATED (show everything). Honest,
      // non-breaking: gating switches on the moment the backend answers.
      setEnabled(null)
      setGated(false)
    } finally {
      setLoading(false)
    }
  }, [owner, isSuperAdmin])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Apply a patch, then adopt the new set the backend computed (keeps the gate honest).
  const apply = useCallback(async (patch: EntitlementPatch) => {
    const res = await EntitlementsApi.update(currentOrg(), patch)
    setEnabled(res.enabled)
    setGated(true)
  }, [])

  const addProducts = useCallback((ids: string[]) => apply({ add: ids }), [apply])
  const removeProducts = useCallback((ids: string[]) => apply({ remove: ids }), [apply])

  return (
    <EntitlementsContext.Provider value={{ enabled, gated, loading, refresh, addProducts, removeProducts }}>
      {children}
    </EntitlementsContext.Provider>
  )
}

/** The active org's entitlements. Safe outside the provider (defaults to ungated). */
export function useEntitlements(): EntitlementsState {
  const ctx = useContext(EntitlementsContext)
  if (!ctx) {
    // Defensive: a consumer mounted outside the provider degrades to ungated (show
    // everything) rather than throwing — the gate must never blank the whole nav.
    return {
      enabled: null,
      gated: false,
      loading: false,
      refresh: async () => {},
      addProducts: async () => {},
      removeProducts: async () => {},
    }
  }
  return ctx
}
