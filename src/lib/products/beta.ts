'use client'

/**
 * useAppsBeta — does this viewer see the beta (Apps) surfaces?
 *
 * ONE source of truth: the enablement plane (`/v1/enablement`), the same
 * self-service opt-in the Beta features module manages, scoped server-side to
 * the caller's validated org. The gate looks for the `apps` feature (kind
 * `feature`, id `apps`) being EFFECTIVE for the org — an admin sets it to
 * `beta` (optionally granting orgs), users opt in where allowed, and this hook
 * simply reads the resulting truth.
 *
 * Fails CLOSED: until the read answers — and whenever it refuses — beta
 * surfaces stay hidden. A superadmin always sees them (mirror of the `admin`
 * gate, and the only way the flag surface itself can be administered when the
 * plane is down). Cached for the session like the org identity is: every nav
 * surface asks, one request answers.
 */
import { useEffect, useState } from 'react'

import { EnablementApi } from '~/lib/api/admin-cockpit'

const APPS_KIND = 'feature'
const APPS_ID = 'apps'

let cached: boolean | null = null
let inflight: Promise<boolean> | null = null

async function readAppsBeta(): Promise<boolean> {
  if (cached !== null) return cached
  if (!inflight) {
    inflight = EnablementApi.view()
      .then((v) => {
        const all = [...v.items, ...v.betas]
        const hit = all.find((i) => i.kind === APPS_KIND && i.id === APPS_ID)
        cached = Boolean(hit?.effective)
        return cached
      })
      .catch(() => {
        // A refusal is not an entitlement. Do not cache it — the next mount
        // may be after sign-in or after the plane recovers.
        inflight = null
        return false
      })
  }
  return inflight
}

export function useAppsBeta(isSuperAdmin: boolean): boolean {
  const [on, setOn] = useState<boolean>(() => isSuperAdmin || cached === true)

  useEffect(() => {
    if (isSuperAdmin) {
      setOn(true)
      return
    }
    let live = true
    readAppsBeta().then((v) => {
      if (live) setOn(v)
    })
    return () => {
      live = false
    }
  }, [isSuperAdmin])

  return on
}
