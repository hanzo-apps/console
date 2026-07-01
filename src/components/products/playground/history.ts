/**
 * Run history — a local record of runs (newest first), capped, PER USER.
 *
 * The reducer (`pushRun`) is pure and unit-tested; the storage wrapper persists to
 * localStorage under a per-user key so one browser's accounts never see each
 * other's runs, and each entry records the model it ran (the History card shows it
 * as a chip). No server round-trip — a run's results are already shown live;
 * History is a convenience recall of the prompt + model + tokens/cost/latency.
 */
export type HistoryColumn = {
  model: string
  ok: boolean
  /** User-stopped (not a success, not an error). */
  stopped?: boolean
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

const KEY_BASE = 'hz.playground.history.v1'
const CAP = 25

/** The localStorage key for a given user (empty/unknown → a shared `anon` bucket). */
function keyFor(userKey: string): string {
  const u = userKey.trim() || 'anon'
  return `${KEY_BASE}::${u}`
}

/** Prepend an entry, newest first, capped at `cap`. Pure. */
export function pushRun(list: HistoryEntry[], entry: HistoryEntry, cap = CAP): HistoryEntry[] {
  return [entry, ...list].slice(0, cap)
}

/** Load a user's history from localStorage (empty on any failure / SSR). */
export function loadHistory(userKey: string): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(keyFor(userKey))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  } catch {
    return []
  }
}

/** Persist a new run for a user and return the updated list. */
export function saveRun(userKey: string, entry: HistoryEntry): HistoryEntry[] {
  const next = pushRun(loadHistory(userKey), entry)
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(keyFor(userKey), JSON.stringify(next))
  } catch {
    /* storage full / unavailable — history is best-effort */
  }
  return next
}

/** Clear a user's stored history. */
export function clearHistory(userKey: string): HistoryEntry[] {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(keyFor(userKey))
  } catch {
    /* ignore */
  }
  return []
}
