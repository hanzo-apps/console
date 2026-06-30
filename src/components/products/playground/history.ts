/**
 * Run history — a local record of compare runs (newest first), capped.
 *
 * The reducer (`pushRun`) is pure and unit-tested; the storage wrapper persists to
 * localStorage so History survives reloads. No server round-trip — a run's results
 * are already shown live; History is a convenience recall of the prompt and which
 * models were compared (with their tokens, cost and latency).
 */
export type HistoryColumn = {
  model: string
  ok: boolean
  promptTokens: number | null
  completionTokens: number | null
  totalUsd: number | null
  ttftMs: number | null
  totalMs: number | null
}

export type HistoryEntry = {
  id: string
  at: number
  mode: 'chat' | 'completions'
  system: string
  user: string
  columns: HistoryColumn[]
}

const KEY = 'hz.playground.history.v1'
const CAP = 25

/** Prepend an entry, newest first, capped at `cap`. Pure. */
export function pushRun(list: HistoryEntry[], entry: HistoryEntry, cap = CAP): HistoryEntry[] {
  return [entry, ...list].slice(0, cap)
}

/** Load history from localStorage (empty on any failure / SSR). */
export function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  } catch {
    return []
  }
}

/** Persist a new run and return the updated list. */
export function saveRun(entry: HistoryEntry): HistoryEntry[] {
  const next = pushRun(loadHistory(), entry)
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage full / unavailable — history is best-effort */
  }
  return next
}

/** Clear stored history. */
export function clearHistory(): HistoryEntry[] {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  return []
}
