'use client'

/**
 * Top-level recovery boundary (Next App Router `global-error`).
 *
 * This REPLACES Next's built-in root fallback — the one that renders the bare,
 * dead-ended "Application error: a client-side exception has occurred" and leaves
 * the SPA wedged (no router, so a later in-app nav back to `/` stays dead until a
 * full reload). It is the OUTERMOST boundary: it catches throws in the root layout
 * and anything that bubbles past the segment boundaries — including a chunk-load
 * failure during the very first hydration, which is exactly the "deep-link /
 * refresh a sub-route → crash" the audit hit (a stale-deploy chunk 404s, falls
 * through to the app-shell HTML, and the browser throws parsing HTML as JS).
 *
 * On a chunk skew it SELF-HEALS: one full reload per window pulls the fresh HTML +
 * current chunks. The reload is bounded by the SAME sessionStorage key every other
 * recovery site uses (`CHUNK_RELOAD_AT_KEY`), so a skew that trips several
 * boundaries at once reloads ONCE, never in a loop. For a genuine (non-chunk)
 * crash it shows a minimal, self-contained recovery card — it runs with the root
 * layout torn down, so it owns its own `<html>`/`<body>` and uses inline styles
 * (no GUI provider is mounted here).
 */
import { useEffect } from 'react'

import { reportError } from '~/lib/event'
import { isChunkLoadError, shouldReloadForChunk, CHUNK_RELOAD_AT_KEY } from '~/components/errors/boundary-logic'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunk = isChunkLoadError(error)

  useEffect(() => {
    console.error('[console] global error:', error)
    // The root layout (and its AnalyticsProvider) is torn down here, so this boundary
    // reports through the module-singleton `eventClient` — the reason it is shared. A
    // chunk skew self-heals below and is not reported; only a genuine crash is.
    if (!chunk) {
      reportError(error, { digest: error.digest, boundary: 'global' })
      return
    }
    if (typeof window === 'undefined') return
    try {
      const raw = window.sessionStorage.getItem(CHUNK_RELOAD_AT_KEY)
      const last = raw ? Number(raw) : null
      if (shouldReloadForChunk(Date.now(), last)) {
        window.sessionStorage.setItem(CHUNK_RELOAD_AT_KEY, String(Date.now()))
        window.location.reload()
      }
    } catch {
      /* sessionStorage blocked (private mode) — fall through to the manual card */
    }
  }, [error, chunk])

  return (
    <html lang="en" style={{ backgroundColor: '#000', colorScheme: 'dark' }}>
      <body style={{ margin: 0, fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif', color: '#fff', backgroundColor: '#000' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 440, width: '100%', border: '1px solid #262626', borderRadius: 12, padding: 24, backgroundColor: '#0a0a0a' }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>
              {chunk ? 'Updating to the latest version' : 'Something went wrong'}
            </h1>
            <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.5, color: '#a3a3a3' }}>
              {chunk
                ? 'A newer version of the console just shipped. Reloading to load the latest…'
                : 'The console hit an unexpected error. Reload to recover, or return home.'}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {!chunk ? (
                <button type="button" onClick={() => reset()} style={btn(true)}>
                  Try again
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => { if (typeof window !== 'undefined') window.location.reload() }}
                style={btn(chunk)}
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => { if (typeof window !== 'undefined') window.location.assign('/') }}
                style={btn(false)}
              >
                Go home
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}

/** Inline button style — primary (filled) vs chromeless (bordered). */
function btn(primary: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 14px',
    borderRadius: 8,
    border: primary ? '1px solid #fff' : '1px solid #333',
    backgroundColor: primary ? '#fff' : 'transparent',
    color: primary ? '#000' : '#e5e5e5',
  }
}
