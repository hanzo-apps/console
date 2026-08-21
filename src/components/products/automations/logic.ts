/**
 * Pure view-logic for the native Automations module (unit-tested; no React, no
 * I/O). Every helper is a total function over the `/v1/auto` view-models so
 * the UI stays a thin render of honest, backend-derived state.
 */
import type { AutomationFlow, FlowRun, Piece } from '~/lib/api/automations'

/**
 * The display name for a flow row. The list endpoint omits displayName (it lives
 * on the version), so fall back to externalId, then a short id — never a
 * fabricated name.
 */
export function flowName(f: Pick<AutomationFlow, 'displayName' | 'externalId' | 'id'>): string {
  const name = (f.displayName ?? '').trim()
  if (name) return name
  const ext = (f.externalId ?? '').trim()
  if (ext) return ext
  return f.id ? `Flow ${f.id.slice(0, 8)}` : 'Untitled flow'
}

/** The lowercased status string a StatusTag tones (ENABLED→green, DISABLED→neutral). */
export const flowStatusText = (status: string): string => (status || 'DISABLED').toLowerCase()

/** The lowercased run status a StatusTag tones (SUCCEEDED→green, FAILED→red, …). */
export const runStatusText = (status: string): string => (status || 'RUNNING').toLowerCase()

export interface FlowSummary {
  total: number
  enabled: number
  disabled: number
}

export function summarizeFlows(flows: AutomationFlow[]): FlowSummary {
  let enabled = 0
  for (const f of flows) if (f.status === 'ENABLED') enabled++
  return { total: flows.length, enabled, disabled: flows.length - enabled }
}

export interface RunSummary {
  total: number
  running: number
  succeeded: number
  failed: number
}

export function summarizeRuns(runs: FlowRun[]): RunSummary {
  const s: RunSummary = { total: runs.length, running: 0, succeeded: 0, failed: 0 }
  for (const r of runs) {
    if (r.status === 'RUNNING' || r.status === 'QUEUED' || r.status === 'PAUSED') s.running++
    else if (r.status === 'SUCCEEDED') s.succeeded++
    else s.failed++ // FAILED | CANCELED | TIMEOUT
  }
  return s
}

/** Sorted, de-duplicated category list across the catalogue — the filter options. */
export function pieceCategories(pieces: Piece[]): string[] {
  const set = new Set<string>()
  for (const p of pieces) for (const c of p.categories) if (c.trim()) set.add(c.trim())
  return [...set].sort((a, b) => a.localeCompare(b))
}

/**
 * Filter the catalogue by a LITERAL case-insensitive substring (never a compiled
 * RegExp of user input — ReDoS-safe) across name/displayName/description/
 * categories, and by an optional exact category. Empty query + empty category →
 * everything.
 */
export function filterPieces(pieces: Piece[], query: string, category: string): Piece[] {
  const q = query.trim().toLowerCase()
  const cat = category.trim()
  return pieces.filter((p) => {
    if (cat && !p.categories.includes(cat)) return false
    if (!q) return true
    const hay = `${p.displayName} ${p.name} ${p.description} ${p.categories.join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
}

/** Honest auth descriptor for a piece card: "OAuth2" / "API key" / "No auth". */
export function authLabel(piece: Pick<Piece, 'auth'>): string {
  if (!piece.auth.required) return 'No auth'
  const t = piece.auth.type.toLowerCase()
  if (t === 'oauth2') return 'OAuth2'
  if (t === 'secret_text' || t === 'api_key' || t === 'apikey') return 'API key'
  if (t === 'bot_token') return 'Bot token'
  if (!t || t === 'none') return 'Connect'
  return piece.auth.type
}

/** "N actions · M triggers" capability summary for a piece card. */
export function capabilitySummary(piece: Pick<Piece, 'actions' | 'triggers'>): string {
  const parts: string[] = []
  const a = piece.actions.length
  const t = piece.triggers.length
  if (a) parts.push(`${a} action${a === 1 ? '' : 's'}`)
  if (t) parts.push(`${t} trigger${t === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

/**
 * A short, honest timestamp for an epoch-millis value. Returns '—' for a missing
 * (0/negative) time rather than a fabricated date. `now` is injectable for tests.
 */
export function formatWhen(ms: number, now: number = Date.now()): string {
  if (!ms || ms <= 0) return '—'
  const diff = now - ms
  if (diff < 0) return new Date(ms).toISOString().slice(0, 10)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(ms).toISOString().slice(0, 10)
}

/** Max flow-name length accepted by the create form (the store bounds text at 2048). */
export const MAX_FLOW_NAME = 200

/**
 * Validate a new flow name. Returns an error string, or null when valid. A flow
 * with a nil trigger is valid server-side, so the ONLY requirement is a non-empty,
 * bounded name.
 */
export function validateFlowName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Enter a name for the flow.'
  if (n.length > MAX_FLOW_NAME) return `Keep the name under ${MAX_FLOW_NAME} characters.`
  return null
}
