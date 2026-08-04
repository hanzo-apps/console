'use client'

/**
 * The console's telemetry surface — the ONE Hanzo telemetry provider, plus the one
 * thing it deliberately leaves to the app.
 *
 * `TelemetrySurface` mounts `@hanzogui/telemetry`, which owns the whole plane for
 * this subtree: pageviews (including SPA route changes), `window.onerror` +
 * `unhandledrejection`, React render errors (its internal boundary REPORTS and
 * re-throws, so the app's own error UI still decides what the user sees), lazily
 * imported interaction capture, and DNT/GPC consent. It replaces the hand-rolled
 * `<AnalyticsProvider>` + bridge + boundary combo; it mounts @hanzo/event's
 * `AnalyticsProvider` internally with its own client, so every existing
 * `useAnalytics()` call site keeps working against that ONE client and one stream.
 * `product="console"` is all the configuration there is — @hanzo/event's DSN
 * registry resolves the hanzo-console Sentry project from it, so the error plane
 * needs no `dsn` prop and no env var.
 *
 * It reads `usePathname()` ITSELF rather than taking a `path` prop from `Provider`:
 * `Provider` memoizes its tree on `children`, so a path read up there would be
 * baked into the cached element and go stale on the first client navigation.
 *
 * `AnalyticsBridge` is the one thing TelemetryProvider does NOT do — `identify`.
 * It binds the person to the STABLE `owner/name` actor id (the same id the API
 * client uses via `setCurrentActor`), never the email, once the session resolves.
 * The org tenant is stamped server-side from the session, so we send the user id
 * only, and anonymous placeholder sessions are skipped. It renders nothing and
 * emits NO pageview — the provider owns those, and a second emitter would
 * double-count every route.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { TelemetryProvider, useTelemetry } from '@hanzogui/telemetry'

import { iamAccessToken } from '~/lib/auth/iam'
import { useSession } from '~/lib/auth/session'
import { type Account } from '~/lib/api/types'

/** The user attributes worth carrying alongside the id, from the IAM claims the
 *  session already decoded. A key is OMITTED rather than sent undefined, so an
 *  absent claim never overwrites a trait a prior identify established. */
export function identityTraits(account: Account): Record<string, unknown> {
  const traits: Record<string, unknown> = {}
  if (account.email) traits.email = account.email
  const name = account.displayName ?? account.name
  if (name) traits.name = name
  return traits
}

export function TelemetrySurface({ children }: { children: ReactNode }) {
  const path = usePathname()
  // @hanzo/iam (PKCE) is the console's ONE credential and it is a BEARER — the same
  // token `lib/api/client.ts` puts on every call — so telemetry authenticates the
  // same way rather than relying on a cookie the ingest host would never receive.
  return (
    <TelemetryProvider product="console" path={path} getToken={iamAccessToken}>
      {children}
    </TelemetryProvider>
  )
}

export function AnalyticsBridge() {
  const telemetry = useTelemetry()
  const { account } = useSession()

  const identified = useRef('')
  useEffect(() => {
    if (!account?.owner || !account?.name || account.type === 'anonymous-user') return
    const personId = `${account.owner}/${account.name}`
    if (identified.current === personId) return
    identified.current = personId
    telemetry.identify(personId)
  }, [account, telemetry])

  return null
}
