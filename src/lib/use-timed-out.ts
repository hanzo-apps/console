import { useEffect, useState } from 'react'

/**
 * `true` once `active` has stayed continuously true for `ms` — the bounded-loading
 * primitive. Wire it as `useTimedOut(phase === 'loading', TILE_LOAD_TIMEOUT_MS)`:
 * while a fetch is pending it arms a one-shot timer; if the fetch settles first
 * (`active` → false) the timer is cleared and the flag resets, so a healthy load
 * NEVER trips it while a hung/slow one (a backend blip that leaves the request
 * pending) degrades the UI at the bound instead of spinning forever. ONE place owns
 * the "loading has a ceiling" rule; every surface that reads a possibly-slow backend
 * composes it (the render decision itself lives in a pure `tileView`, unit-tested).
 */
export function useTimedOut(active: boolean, ms: number): boolean {
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    if (!active) {
      setTimedOut(false)
      return
    }
    setTimedOut(false)
    const timer = setTimeout(() => setTimedOut(true), ms)
    return () => clearTimeout(timer)
  }, [active, ms])
  return timedOut
}
