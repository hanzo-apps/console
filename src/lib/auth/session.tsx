'use client'

/**
 * Session context — the one source of auth truth for the console.
 *
 * On mount it resolves the account via `AccountApi.session()` (the console's OWN
 * durable OAuth session first, casibase fallback). `signIn()` redirects to IAM;
 * `completeSignIn(code, state)` (the callback route) posts to `/v1/iam/signin` to mint
 * the casibase session; `establishConsoleSession(email, password)` upgrades a password
 * login to the durable, refreshable console session.
 *
 * SILENT REFRESH. When a console session exists we arm a PROACTIVE timer at ~80% of
 * the access-token lifetime that calls `refreshSession()` and reloads — so a
 * short-lived access token (post the IAM 1h-access hardening) is renewed before it
 * expires and the user is never bounced. The REACTIVE half (a 401 → refresh → retry)
 * lives in the API client. Both go through the ONE single-flight `refreshSession`.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import { AccountApi, type Account } from '~/lib/api'
import { withTimeout } from '~/lib/with-timeout'
import { isAdminHost } from '~/config'
import { getProviderSigninUrl, getSigninUrl, stashReturnTo } from './iam'
import { refreshSession } from './refresh'
import { setCurrentActor } from '~/lib/actor-scope'
import { claimReferralOnce, stashReferralCode } from '~/lib/referrals/claim'
import { attributeAffiliateOnce, stashAffiliateCode } from '~/lib/affiliates/claim'

type SessionState = {
  account: Account | null
  loading: boolean
  signIn: () => void
  signInWith: (provider: string) => void
  completeSignIn: (code: string, state: string, verifier?: string) => Promise<void>
  /** Upgrade a password login to the durable, refreshable console session. */
  establishConsoleSession: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  reload: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

/** Only proactively refresh when the access token is short enough to expire in a
 *  session — a long (multi-day) token relies on the reactive 401 + self-heal-on-load
 *  path instead (and a multi-day setTimeout is unreliable). Floor keeps a tiny TTL
 *  from busy-looping. */
const MIN_PROACTIVE_MS = 30_000
const MAX_PROACTIVE_MS = 2 * 60 * 60 * 1000 // 2h

/** Cap the boot session resolve so a slow/hung backend can't hold the splash
 *  forever — on timeout the visitor is anonymous and the sign-in card renders. */
const SESSION_BOOT_TIMEOUT_MS = 8_000

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reloadRef = useRef<() => void>(() => {})

  // Set the account AND keep the synchronous actor id (read by the API client's
  // baseHeaders) in lockstep — one source of auth truth for org (org-scope) + user.
  const applyAccount = useCallback((a: Account | null) => {
    setAccount(a)
    setCurrentActor(a && a.owner && a.name ? `${a.owner}/${a.name}` : '')
    if (a && a.owner && a.name) {
      // Claim a stashed referral (?ref= captured at signup) → binds this org as the
      // referee. Once per session per org, server-idempotent, best-effort.
      claimReferralOnce(a.owner)
      // Attribute a stashed affiliate (?aff= captured at signup) → binds this org to
      // the affiliate. Orthogonal to the referral above (an org can be both); once per
      // session per org, server-idempotent, best-effort.
      attributeAffiliateOnce(a.owner)
    }
  }, [])

  /** (Re)arm the proactive refresh timer for the given remaining lifetime. */
  const armRefresh = useCallback((expiresIn: number | null) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (typeof window === 'undefined' || !expiresIn || expiresIn <= 0) return
    const delayMs = expiresIn * 0.8 * 1000
    if (delayMs > MAX_PROACTIVE_MS) return // long token → reactive/self-heal handles it
    timerRef.current = setTimeout(() => {
      // Refresh (single-flight), then reload to pick up the new account + lifetime and
      // re-arm. A failed refresh → reload → session() falls back / bounces gracefully.
      void refreshSession().finally(() => reloadRef.current())
    }, Math.max(MIN_PROACTIVE_MS, delayMs))
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      // The boot "who am I" (AccountApi.session → /v1/iam/get-account) must never
      // pin the splash: a degraded backend (the beego IAM proxy hop, a dead pruned
      // route) can leave it pending indefinitely. Cap it — on timeout treat the
      // visitor as anonymous so the sign-in card renders. A later reload/refresh
      // (or a recovered backend) resolves the real session.
      const { account: acct, expiresIn } = await withTimeout(
        AccountApi.session(),
        SESSION_BOOT_TIMEOUT_MS,
        { account: null, expiresIn: null },
      )
      applyAccount(acct)
      armRefresh(acct ? expiresIn : null)
    } finally {
      setLoading(false)
    }
  }, [armRefresh])

  // Keep the ref pointing at the latest reload so the timer callback never goes stale.
  useEffect(() => {
    reloadRef.current = reload
  }, [reload])

  useEffect(() => {
    // Capture a ?ref=<code> from the landing URL BEFORE auth resolves, so a referral
    // link survives the OAuth round-trip and is claimed on first authenticated load.
    stashReferralCode()
    // Same for an ?aff=<code> affiliate link (orthogonal capture).
    stashAffiliateCode()
    void reload()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [reload])

  const signIn = useCallback(() => {
    // Remember the current task so re-auth returns here (graceful mid-task expiry).
    stashReturnTo()
    window.location.assign(getSigninUrl())
  }, [])

  const signInWith = useCallback((provider: string) => {
    stashReturnTo()
    window.location.assign(getProviderSigninUrl(provider))
  }, [])

  const completeSignIn = useCallback(async (code: string, state: string, verifier?: string) => {
    // Admin host: the code was minted for the PUBLIC admin-console client, so redeem it
    // through the console's OWN BFF (PKCE, no secret) into the durable hz_session — the
    // cloud backend would redeem with the wrong (hanzo-cloud) client. Every other host
    // keeps the cloud-backend `/v1/iam/signin` exchange.
    if (verifier && isAdminHost(window.location.hostname)) {
      const r = await AccountApi.consoleSignin(code, verifier)
      applyAccount(r.account)
      return
    }
    const res = await AccountApi.signin(code, state)
    applyAccount(res.data ?? (await AccountApi.current()))
  }, [applyAccount])

  const establishConsoleSession = useCallback(
    async (username: string, password: string) => {
      const r = await AccountApi.establishSession(username, password)
      if (r?.account) {
        applyAccount(r.account)
        armRefresh(r.expiresIn)
      }
    },
    [armRefresh],
  )

  const signOut = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    await AccountApi.signout()
    applyAccount(null)
    // Redirect DETERMINISTICALLY to /signin. AuthGate's reactive redirect (on
    // account → null) can be pre-empted by an in-flight session read re-hydrating
    // the account, leaving the user stranded on `/` even though the server session
    // is dead. A hard navigation is the single source of truth for "signed out →
    // /signin" and also clears all in-memory state (org scope, caches, balances) —
    // the same `window.location.assign` the sign-IN path uses.
    if (typeof window !== 'undefined') window.location.assign('/signin')
  }, [])

  return (
    <SessionContext.Provider
      value={{ account, loading, signIn, signInWith, completeSignIn, establishConsoleSession, signOut, reload }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>')
  return ctx
}
