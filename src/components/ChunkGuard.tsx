'use client'

/**
 * ChunkGuard — recover gracefully from a stale-deploy chunk error.
 *
 * After a console deploy, an open tab still references the previous build's
 * hashed chunks. Those chunk URLs no longer exist, so the request falls through
 * to the app shell (HTML), and the browser throws `ChunkLoadError` /
 * "Unexpected token '<'" trying to parse HTML as JS — an unrecoverable blank
 * screen. This catches that exact failure and does ONE full reload, which pulls
 * the fresh HTML + current chunks. A sessionStorage flag prevents reload loops
 * if the failure is genuine (not a stale deploy); it clears on the next load.
 */
import { useEffect } from 'react'

const FLAG = 'hz_chunk_reloaded'
const PATTERN = /ChunkLoadError|Loading chunk [\d]+ failed|Loading CSS chunk|Importing a module script failed|Unexpected token '<'/i

export function ChunkGuard() {
  useEffect(() => {
    // A clean load means any prior stale-chunk reload worked — reset the guard.
    try {
      sessionStorage.removeItem(FLAG)
    } catch {
      /* sessionStorage may be unavailable (private mode) — best-effort only */
    }

    const recover = (message: string) => {
      if (!PATTERN.test(message)) return
      try {
        if (sessionStorage.getItem(FLAG)) return // already tried once — let the error surface
        sessionStorage.setItem(FLAG, '1')
      } catch {
        /* ignore */
      }
      window.location.reload()
    }

    const onError = (e: ErrorEvent) => recover(e?.message ?? String(e?.error ?? ''))
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e?.reason
      recover(typeof r === 'string' ? r : (r?.message ?? ''))
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
