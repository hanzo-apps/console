'use client'

/**
 * usePlanGate — is this org allowed the premium (frontier-priced) models?
 *
 * One question, answered from the org's own subscriptions over the same
 * scoped `/billing/*` proxy every billing module uses: any subscription in a
 * standing state (active | trialing | past_due) counts as a plan. The GATEWAY
 * is the enforcement point — it 402s a premium run regardless of what any UI
 * shows — so this hook only decides what the picker OFFERS, and it fails
 * OPEN: if billing is unreachable the playground offers everything and lets
 * the gateway answer, because hiding models on a flaky proxy would read as
 * "the catalog shrank".
 */
import { useEffect, useState } from 'react'

import { BillingApi } from '~/lib/api/billing'

const STANDING = new Set(['active', 'trialing', 'past_due'])

export function usePlanGate(): { paid: boolean; resolved: boolean } {
  const [state, setState] = useState({ paid: true, resolved: false })

  useEffect(() => {
    let alive = true
    BillingApi.subscriptions()
      .then((subs) => {
        if (!alive) return
        const paid = subs.some((s) => STANDING.has((s.status ?? 'active').toLowerCase()))
        setState({ paid, resolved: true })
      })
      .catch(() => {
        if (alive) setState({ paid: true, resolved: true })
      })
    return () => {
      alive = false
    }
  }, [])

  return state
}
