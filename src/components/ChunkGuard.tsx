'use client'

/**
 * ChunkGuard — window-level net that recovers from a stale-deploy chunk 404.
 *
 * On a rolling deploy an open tab (or a fresh deep-link that lands on the other
 * replica) requests a hashed chunk that no longer exists on the replica it hits.
 * The 404 falls through to the app-shell HTML, so the browser throws
 * `ChunkLoadError` / "Unexpected token '<'" trying to parse HTML as JS — a blank,
 * unrecoverable screen. This catches that at the WINDOW level and does one full
 * reload, which pulls the fresh HTML + current chunks.
 *
 * Two catch surfaces, because a chunk 404 surfaces two ways:
 *  - CAPTURE-phase `error` on the failing `<script>`/`<link>` element — a resource
 *    load error does NOT bubble, so only a capture listener sees it. This fires on
 *    the RAW 404 during the initial deep-link load, before webpack's loader even
 *    rejects — the earliest, most reliable signal for "refresh a sub-route 404s a
 *    chunk".
 *  - `unhandledrejection` / bubbled `error` carrying a `ChunkLoadError` message —
 *    webpack's dynamic-import path.
 *
 * The React error boundaries (`global-error`, the dashboard segment,
 * `ProductErrorBoundary`) catch the same class at RENDER time; this complements
 * them for the async/resource paths a render boundary never sees. Every recovery
 * site — this net and all three boundaries — shares ONE loop-breaker
 * (`shouldReloadForChunk` bounded by `CHUNK_RELOAD_AT_KEY`), so a persistent skew
 * reloads at most once per window and never spins. Chunk detection is shared too
 * (`isChunkLoadError`) — one definition of "this is a chunk skew" for the whole app.
 */
import { useEffect } from 'react'

import { isChunkLoadError, shouldReloadForChunk, CHUNK_RELOAD_AT_KEY } from '~/components/errors/boundary-logic'

/** True when a failed resource load targets a Next build asset (script/link). */
function isNextAssetError(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as Partial<HTMLScriptElement & HTMLLinkElement>
  const url = el.src || el.href
  return typeof url === 'string' && url.includes('/_next/static/')
}

export function ChunkGuard() {
  useEffect(() => {
    // Reload at most once per window, coordinated with the render boundaries so a
    // skew that trips several detectors at once reloads ONCE (the timestamp ages
    // out, so a genuine later skew can still recover) — never a reload loop.
    const recover = () => {
      try {
        const raw = window.sessionStorage.getItem(CHUNK_RELOAD_AT_KEY)
        const last = raw ? Number(raw) : null
        if (!shouldReloadForChunk(Date.now(), last)) return
        window.sessionStorage.setItem(CHUNK_RELOAD_AT_KEY, String(Date.now()))
        window.location.reload()
      } catch {
        /* sessionStorage blocked (private mode) — let a render boundary show its card */
      }
    }

    const onError = (e: ErrorEvent) => {
      if (isNextAssetError(e.target) || isChunkLoadError(e.error ?? e.message)) recover()
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) recover()
    }

    // `capture: true` so the non-bubbling resource-load error on a 404'd chunk
    // element reaches us.
    window.addEventListener('error', onError, true)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError, true)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
