'use client'

/**
 * The palette registry — the ONE place a module contributes ⌘K entries.
 *
 * A module declares what it can offer while it is on screen (its live rows, its
 * verbs) and the palette ranks them beside the product catalog and the global
 * actions. Nothing is hard-coded in the palette: contribution is by mount.
 *
 *   const items = useMemo(() => volumes.map((v) => ({
 *     id: `vol:${v.id}`, label: v.name, sublabel: v.region, group: 'Volumes',
 *     run: () => open(v),
 *   })), [volumes])
 *   usePaletteItems(items)
 *
 * Entries are ref-counted by `id`, so two mounted contributors of the same id
 * don't cancel each other when only one unmounts.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type PaletteItem = {
  /** Stable and unique across the app — the ref-count key. */
  id: string
  label: string
  /** The disambiguator: the org, region, or id this row belongs to. */
  sublabel?: string
  /** Section heading, e.g. 'Organizations', 'Volumes', 'Subsystems'. */
  group: string
  /** Extra fuzzy-match text (synonyms) — never shown. */
  keywords?: string
  run: () => void | Promise<void>
  /** Requires an explicit confirm step before `run()`, even from the palette. */
  destructive?: boolean
  /** Confirmation prompt; defaults to `${label}?`. */
  confirm?: string
}

type Registry = {
  items: PaletteItem[]
  /** Adds a batch and returns its remover. */
  register: (batch: PaletteItem[]) => () => void
}

const Ctx = createContext<Registry | null>(null)

/** Contribute items while the calling component is mounted. */
export function usePaletteItems(items: PaletteItem[]): void {
  // Depend on `register` (stable), NEVER on the context object — its identity changes
  // every time ANY contributor registers, which would re-register this batch, which
  // would change it again: a loop. Array identity is the contract: callers pass a
  // `useMemo`'d array; deep-comparing every keystroke costs more than re-registering.
  const register = useContext(Ctx)?.register
  useEffect(() => register?.(items), [register, items])
  if (!register) throw new Error('usePaletteItems must be used within <PaletteRegistry>')
}

/** The currently-contributed items (the palette reads this). */
export function usePaletteRegistry(): PaletteItem[] {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePaletteRegistry must be used within <PaletteRegistry>')
  return ctx.items
}

export function PaletteRegistry({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<PaletteItem[]>([])
  const slots = useRef(new Map<string, { item: PaletteItem; n: number }>())

  const register = useCallback((batch: PaletteItem[]) => {
    for (const item of batch) {
      const cur = slots.current.get(item.id)
      slots.current.set(item.id, { item, n: (cur?.n ?? 0) + 1 })
    }
    setItems([...slots.current.values()].map((s) => s.item))
    return () => {
      for (const item of batch) {
        const cur = slots.current.get(item.id)
        if (!cur) continue
        if (cur.n <= 1) slots.current.delete(item.id)
        else slots.current.set(item.id, { item: cur.item, n: cur.n - 1 })
      }
      setItems([...slots.current.values()].map((s) => s.item))
    }
  }, [])

  return <Ctx.Provider value={useMemo(() => ({ items, register }), [items, register])}>{children}</Ctx.Provider>
}
