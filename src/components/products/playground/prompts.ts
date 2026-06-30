/**
 * Saved prompts — a local library of starting points the user saved with the
 * header "Save prompt" action.
 *
 * The reducer (`pushSaved`) is pure and unit-tested; the storage wrapper persists
 * to localStorage so saved prompts survive reloads. Newest first, de-duplicated by
 * id, capped. No server round-trip — these are the user's own reusable prompts,
 * surfaced alongside the curated Examples.
 */
export type SavedPrompt = {
  id: string
  name: string
  model: string
  system: string
  user: string
  at: number
}

const KEY = 'hz.playground.saved.v1'
const CAP = 30

/** Prepend an entry, newest first, de-duplicated by id, capped at `cap`. Pure. */
export function pushSaved(list: SavedPrompt[], entry: SavedPrompt, cap = CAP): SavedPrompt[] {
  return [entry, ...list.filter((p) => p.id !== entry.id)].slice(0, cap)
}

/** Load saved prompts from localStorage (empty on any failure / SSR). */
export function loadSaved(): SavedPrompt[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedPrompt[]) : []
  } catch {
    return []
  }
}

/** Persist a new saved prompt and return the updated list. */
export function saveSaved(entry: SavedPrompt): SavedPrompt[] {
  const next = pushSaved(loadSaved(), entry)
  persist(next)
  return next
}

/** Remove a saved prompt by id and return the updated list. */
export function removeSaved(id: string): SavedPrompt[] {
  const next = loadSaved().filter((p) => p.id !== id)
  persist(next)
  return next
}

function persist(list: SavedPrompt[]): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage full / unavailable — saved prompts are best-effort */
  }
}
