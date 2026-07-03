'use client'

/**
 * useReloadOnFocus — refetch when the user returns to the tab.
 *
 * A module that loads its inventory ONCE on mount goes stale when a record is
 * created out-of-band (the API, the CLI, another tab) — the console wouldn't show
 * a just-deployed function until a manual reload. This hook re-runs `reload` on
 * window `focus` and on the tab becoming visible again, so the list self-freshens
 * the moment the operator looks at it. The wiring is a PURE function over an
 * injected target, so it is unit-tested without a DOM.
 */
import { useEffect } from 'react'

export type FocusReloadTarget = {
  add: (type: string, cb: () => void) => void
  remove: (type: string, cb: () => void) => void
  /** False when the document is a hidden/background tab. */
  isVisible: () => boolean
}

/**
 * Bind `reload` to window `focus` + `visibilitychange` (visible only) on the given
 * target. Returns a cleanup that unbinds both — no leaked listeners.
 */
export function armReloadOnFocus(target: FocusReloadTarget, reload: () => void): () => void {
  const onFocus = () => reload()
  const onVisible = () => {
    if (target.isVisible()) reload()
  }
  target.add('focus', onFocus)
  target.add('visibilitychange', onVisible)
  return () => {
    target.remove('focus', onFocus)
    target.remove('visibilitychange', onVisible)
  }
}

/** Bind `armReloadOnFocus` to the real window/document, cleaned up on unmount. */
export function useReloadOnFocus(reload: () => void): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    // `focus` is a window event; `visibilitychange` is a document event.
    return armReloadOnFocus(
      {
        add: (t, cb) => (t === 'visibilitychange' ? document : window).addEventListener(t, cb),
        remove: (t, cb) => (t === 'visibilitychange' ? document : window).removeEventListener(t, cb),
        isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
      },
      reload,
    )
  }, [reload])
}
