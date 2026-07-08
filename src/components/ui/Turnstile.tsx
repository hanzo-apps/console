'use client'

/**
 * Cloudflare Turnstile widget — the client half of the signup bot wall.
 *
 * Renders the invisible/managed challenge and hands its token up via `onToken`;
 * the server (`/auth/signup` → `verifyTurnstile`) is the real enforcer. CONFIG-GATED
 * on the PUBLIC site key: with `NEXT_PUBLIC_TURNSTILE_SITE_KEY` unset the component
 * renders nothing and no token is produced (the server verifier is inert too), so a
 * deployment without Turnstile provisioned still signs users up. NO new dependency —
 * Cloudflare's `api.js` is injected once from its own origin (no CSP is set on the
 * console, and this is Cloudflare's canonical embed).
 */
import { useEffect, useRef } from 'react'

const SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim()
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      callback: (token: string) => void
      'error-callback'?: () => void
      'expired-callback'?: () => void
    },
  ) => string
  reset: (id?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/** True when Turnstile is provisioned client-side (the widget will render). */
export const turnstileConfigured = (): boolean => SITE_KEY !== ''

export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef(onToken)
  cb.current = onToken
  const rendered = useRef(false)

  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false

    const render = () => {
      if (cancelled || rendered.current || !host.current || !window.turnstile) return
      rendered.current = true
      window.turnstile.render(host.current, {
        sitekey: SITE_KEY,
        callback: (t) => cb.current(t),
        'error-callback': () => cb.current(''),
        'expired-callback': () => cb.current(''),
      })
    }

    if (window.turnstile) {
      render()
      return () => {
        cancelled = true
      }
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', render)
    } else {
      const s = document.createElement('script')
      s.src = SCRIPT_SRC
      s.async = true
      s.defer = true
      s.addEventListener('load', render)
      document.head.appendChild(s)
    }
    return () => {
      cancelled = true
    }
  }, [])

  if (!SITE_KEY) return null
  return <div ref={host} />
}
