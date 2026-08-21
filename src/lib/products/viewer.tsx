'use client'

/**
 * Who is looking, as ONE value — the single source every visibility decision
 * reads (`~/lib/products/stage`).
 *
 * Two facts, from two authorities that must never be braided:
 *
 *   ADMIN — membership of the reserved `admin` org (`owner === 'admin'`, the same
 *     equality IAM's `User.IsSuperAdmin()` uses). Identity, not preference: there
 *     is no request a customer can make that sets it, and the server enforces the
 *     same thing independently.
 *
 *   BETA — the org opted into pre-GA products. It rides the platform's existing
 *     org-scoped opt-in (`/v1/pricing/enablement`, `kind: 'feature'`), which keys on the
 *     VALIDATED caller org, so the switch is org-wide by construction rather than
 *     by convention: two members of one org can never see different products, and
 *     nobody can opt in an org they are not in.
 *
 * The opt-in is fetched ONCE here so the rail, ⌘K, All-products, the home map and
 * the category pages cannot disagree, and so the answer does not depend on which
 * screen you happened to load first. Before it lands the viewer is `customer` —
 * GA only. Erring toward LESS is the honest default: showing a half-finished
 * product for a moment and then removing it is worse than never showing it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useSession } from '~/lib/auth/session'
import { isSuperAdminAccount } from '~/lib/auth/admin'
import { EnablementApi } from '~/lib/api/admin-cockpit'
import { type Viewer, customer } from './stage'

/** The enablement item the org-wide opt-in rides. `feature` is that registry's
 *  generic lane; `beta` is this one switch. The ONE place the pair is written. */
export const BETA = { kind: 'feature', id: 'beta' } as const

type State = {
  viewer: Viewer
  /** True when the platform offers the opt-in at all — the operator has put the
   *  item in beta. False keeps Settings quiet rather than showing a dead switch. */
  offered: boolean
  /** Take or drop the org's opt-in. Throws the server's own refusal. */
  setBeta: (on: boolean) => Promise<void>
}

const Ctx = createContext<State | null>(null)

export function ViewerProvider({ children }: { children: ReactNode }) {
  const { account } = useSession()
  const admin = isSuperAdminAccount(account)
  const owner = account?.owner ?? ''

  const [beta, setBetaState] = useState(false)
  const [offered, setOffered] = useState(false)

  const read = useCallback(async () => {
    if (!owner) {
      setBetaState(false)
      setOffered(false)
      return
    }
    try {
      const view = await EnablementApi.view()
      const item = view.items.find((i) => i.kind === BETA.kind && i.id === BETA.id)
      setBetaState(Boolean(item?.optedIn))
      // Offered when the org can still take it, or already has — i.e. the item
      // exists and is in beta. An unregistered item is absent from both lists.
      setOffered(Boolean(item?.optedIn || item?.canOptIn))
    } catch {
      // Unreachable registry → GA only. An error is not a grant.
      setBetaState(false)
      setOffered(false)
    }
  }, [owner])

  useEffect(() => {
    void read()
  }, [read])

  const setBeta = useCallback(async (on: boolean) => {
    if (on) await EnablementApi.optIn({ ...BETA })
    else await EnablementApi.optOut({ ...BETA })
    await read()
  }, [read])

  const state = useMemo<State>(
    () => ({ viewer: { admin, beta }, offered, setBeta }),
    [admin, beta, offered, setBeta],
  )
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

/** The viewer every surface decides on. Outside the provider: GA only. */
export function useViewer(): Viewer {
  return useContext(Ctx)?.viewer ?? customer
}

/** The org's opt-in, for the ONE switch in Settings that owns it. */
export function useBeta(): { on: boolean; offered: boolean; set: (on: boolean) => Promise<void> } {
  const ctx = useContext(Ctx)
  return {
    on: ctx?.viewer.beta ?? false,
    offered: ctx?.offered ?? false,
    set: ctx?.setBeta ?? (async () => {}),
  }
}
