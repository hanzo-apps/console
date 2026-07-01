'use client'

/**
 * Base — the embedded Hanzo Base (superbase) tenant manager.
 *
 * This module renders the SAME screens that run standalone at base.hanzo.ai: the
 * host-agnostic `@hanzo/dash` package (TenantsScreen /
 * NewTenantScreen). console2 is just the host — it injects the transport and the
 * navigation, nothing more. There is ONE source of these screens; this file does
 * not reimplement them.
 *
 * Transport: the screens call console2's OWN `/superbase/*` proxy with the
 * session cookie (`credentials: 'include'`); the proxy mints + forwards the
 * user's IAM bearer to base.hanzo.ai server-side, so no token reaches the
 * browser. Base authorizes per-user (tenant ListRule + admin-only mutations).
 *
 * Routing: the product lives at `/base` (list, with a detail drawer) and
 * `/base/new` (create). Detail is a client-state drawer inside TenantsScreen —
 * not a route — so it works identically embedded and standalone. We read the
 * pathname to pick the screen and push to switch; `params` is unused.
 */
import { useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  createTenantsApi,
  TenantsScreen,
  NewTenantScreen,
  type TenantsNav,
} from '@hanzo/dash'
import { currentOrg } from '~/lib/org-scope'
import { useScope } from '~/lib/scope-context'

/** Product base path — must match the registry entry id (`base`). */
const BASE_PATH = '/base'

export function BaseModule() {
  const router = useRouter()
  const pathname = usePathname()

  // Same-origin proxy + session cookie; the proxy injects the bearer server-side.
  const api = useMemo(
    () => createTenantsApi({ baseUrl: '/superbase', credentials: 'include' }),
    [],
  )

  const nav = useMemo<TenantsNav>(
    () => ({
      // The detail drawer carries selection client-side, so returning to the
      // list is a plain push (no `?selected=` round-trip needed in the embed).
      toList: () => router.push(BASE_PATH),
      toNew: () => router.push(`${BASE_PATH}/new`),
    }),
    [router],
  )

  // A superbase "tenant" IS a full Hanzo Base instance, so the IAM-native console
  // labels these "Bases" and shows the Org → Project scope (from the top-bar
  // ScopeSwitcher) as a breadcrumb — consistent with every other resource module.
  const labels = useMemo(
    () => ({ singular: 'Base', plural: 'Bases', create: 'New Base' }),
    [],
  )
  const { scope } = useScope()
  const context = `${currentOrg()} / ${scope.project ?? 'All projects'}`

  const isNew = pathname?.endsWith('/new') ?? false
  return isNew ? (
    <NewTenantScreen api={api} nav={nav} labels={labels} />
  ) : (
    <TenantsScreen api={api} nav={nav} labels={labels} context={context} />
  )
}

export default BaseModule
