// Pure formatters for the Research board — no JSX, so they're unit-testable in isolation.
// The board's premise is "every figure is a real measured aggregate", so these must never
// corrupt a value.

export const fmtValue = (v: number): string => {
  if (!Number.isFinite(v)) return '—'
  if (Number.isInteger(v)) return v.toLocaleString()
  const abs = Math.abs(v)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 3
  const s = v.toFixed(digits)
  if (!s.includes('.')) {
    // abs>=100 rounds to a dotless integer string; group it like the integer path
    // (1000.4 → "1,000", matching 1000 → "1,000") — a naive trailing-zero trim here would
    // eat its real zeros (150.4 → "150" → "15").
    return Number(s).toLocaleString()
  }
  // Trim trailing fractional zeros only when a decimal point is present.
  return s.replace(/0+$/, '').replace(/\.$/, '')
}

export const fmtDate = (ts: number): string => {
  if (!(ts > 0)) return ''
  const d = new Date(ts * 1000)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

// A stable row identity that can't collide across id-less rows: an experiment is kept on
// (id || subject), so ≥2 id-less rows would share the React key '' and expand together.
// Fall back to subject:task so each renders + expands independently.
export const rowKeyOf = (e: { id: string; subject: string; task: string }): string => e.id || `${e.subject}:${e.task}`
