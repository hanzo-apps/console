'use client'

/**
 * The console's keyboard layer — ONE registry, ONE listener.
 *
 * A surface declares the keys it answers to while it is mounted; the provider owns
 * the single `keydown` listener, the two-key sequence timer, and the typing guard.
 * Because every binding is registered rather than wired ad hoc, `?` can print an
 * honest, complete cheatsheet of what is actually live right now.
 *
 *   useHotkeys(useMemo(() => [
 *     { keys: 'c', label: 'New issue', group: 'Tracker', run: create },
 *     { keys: 'g h', label: 'Go home', group: 'Navigation', run: () => router.push('/') },
 *   ], [create, router]))
 *
 * Global defaults live here: `mod+k` toggles the palette and `/` asks the page to
 * focus its filter (a `hanzo:focus-filter` window event — the provider does not
 * reach into anyone's DOM). `?` is owned by the cheatsheet itself.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { chordMatches, isEditableTarget, parseHotkey } from '~/lib/hotkeys'
import { useCommandPalette } from '~/components/CommandPalette'

export type Hotkey = {
  /** `'?'`, `'/'`, `'mod+k'` (⌘/Ctrl), or a two-key sequence `'g h'`. */
  keys: string
  label: string
  /** Cheatsheet section, e.g. 'Navigation', 'Tracker'. */
  group: string
  run: () => void
  /** Live gate — a `false` return makes the binding inert without unregistering. */
  when?: () => boolean
}

/** How long the first key of a sequence stays armed. */
const SEQUENCE_MS = 1000

/** The window event `/` fires; a page listens and focuses its filter input. */
export const FOCUS_FILTER_EVENT = 'hanzo:focus-filter'

type Registry = { all: Hotkey[]; register: (batch: Hotkey[]) => () => void }

const Ctx = createContext<Registry | null>(null)

/** Register hotkeys while the calling component is mounted. */
export function useHotkeys(hotkeys: Hotkey[]): void {
  // Depend on `register` (stable), NEVER on the context object — its identity changes
  // whenever ANY surface registers, and re-registering here would change it again.
  // Array identity is the contract: pass a `useMemo`'d array.
  const register = useContext(Ctx)?.register
  useEffect(() => register?.(hotkeys), [register, hotkeys])
  if (!register) throw new Error('useHotkeys must be used within <HotkeyProvider>')
}

/** Every hotkey live right now (the cheatsheet reads this). */
export function useHotkeyRegistry(): Hotkey[] {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useHotkeyRegistry must be used within <HotkeyProvider>')
  return ctx.all
}

export function HotkeyProvider({ children }: { children: ReactNode }) {
  const palette = useCommandPalette()
  const [batches, setBatches] = useState<Hotkey[][]>([])

  const register = useCallback((batch: Hotkey[]) => {
    setBatches((b) => [...b, batch])
    return () => setBatches((b) => b.filter((x) => x !== batch))
  }, [])

  const defaults = useMemo<Hotkey[]>(
    () => [
      {
        keys: 'mod+k',
        label: 'Command palette',
        group: 'General',
        run: () => (palette.isOpen ? palette.close() : palette.open()),
      },
      {
        keys: '/',
        label: 'Focus filter',
        group: 'General',
        run: () => window.dispatchEvent(new CustomEvent(FOCUS_FILTER_EVENT)),
      },
    ],
    [palette],
  )

  const all = useMemo(() => [...defaults, ...batches.flat()], [defaults, batches])

  // The listener binds once and reads the current set through a ref, so mounting a
  // module (or every keystroke re-memoising its bindings) never re-binds `keydown`.
  const live = useRef(all)
  useEffect(() => {
    live.current = all
  }, [all])

  useEffect(() => {
    let pending: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const disarm = () => {
      pending = null
      if (timer) clearTimeout(timer)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const editable = isEditableTarget(e.target)
      const active = live.current
        .filter((h) => h.when?.() !== false)
        .map((h) => ({ h, chords: parseHotkey(h.keys) }))

      // Second key of an armed sequence. A miss disarms and falls through, so the
      // key still gets its own chance rather than being swallowed.
      if (pending) {
        const first = pending
        disarm()
        const seq = active.find(
          ({ chords }) => chords.length === 2 && chords[0]!.key === first && chordMatches(chords[1]!, e, editable),
        )
        if (seq) {
          e.preventDefault()
          seq.h.run()
          return
        }
      }

      const single = active.find(({ chords }) => chords.length === 1 && chordMatches(chords[0]!, e, editable))
      if (single) {
        e.preventDefault()
        single.h.run()
        return
      }

      if (active.some(({ chords }) => chords.length === 2 && chordMatches(chords[0]!, e, editable))) {
        e.preventDefault()
        pending = e.key.toLowerCase()
        timer = setTimeout(disarm, SEQUENCE_MS)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      disarm()
    }
  }, [])

  const value = useMemo(() => ({ all, register }), [all, register])
  return createElement(Ctx.Provider, { value }, children)
}
