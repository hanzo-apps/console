/**
 * Accessibility scan — PURE processing of an axe-core result into an honest,
 * sorted issue list the console can render. The DOM scan itself (dynamic
 * `import('axe-core')` + `axe.run(document)`) lives in the client module
 * (`AccessibilityModule.tsx`); everything here is a pure function so it is unit
 * tested without a browser, an engine, or a network — the crm.ts normalizer
 * discipline applied to WCAG results.
 *
 * Defensive by construction: a shape change in axe (or garbage) degrades a field
 * rather than throwing — a scan never crashes the panel.
 */

export type Impact = 'critical' | 'serious' | 'moderate' | 'minor'

/** Severity order, worst first — the display + sort order. */
export const IMPACTS: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'] as const
const RANK: Record<Impact, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 }

export type A11yIssue = {
  /** axe rule id, e.g. `color-contrast`. */
  id: string
  impact: Impact
  /** one-line human description of the rule. */
  help: string
  /** Deque docs URL with remediation guidance. */
  helpUrl: string
  /** readable WCAG labels derived from the axe tags (SC numbers + conformance levels). */
  wcag: string[]
  /** number of failing elements on the page. */
  nodes: number
  /** CSS selector of the first failing element (where to look). */
  target: string
}

export type A11ySummary = { total: number; byImpact: Record<Impact, number> }

// ── coercion helpers (never throw) ───────────────────────────────────────────
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const asImpact = (v: unknown): Impact =>
  v === 'critical' || v === 'serious' || v === 'moderate' || v === 'minor' ? v : 'minor'

/**
 * axe tags → readable WCAG labels. Only `wcag*` tags are surfaced (category /
 * best-practice tags are dropped): a success criterion `wcag143` → `1.4.3`, a
 * conformance level `wcag21aa` → `WCAG 2.1 AA`.
 */
export function wcagTags(tags: unknown): string[] {
  const out: string[] = []
  for (const t of asArray(tags)) {
    const s = str(t)
    const sc = /^wcag(\d)(\d)(\d+)$/.exec(s) // success criterion
    if (sc) {
      out.push(`${sc[1]}.${sc[2]}.${sc[3]}`)
      continue
    }
    const lvl = /^wcag(2|21|22)(a|aa|aaa)$/.exec(s) // conformance level
    if (lvl) {
      const ver = lvl[1] === '2' ? '2' : `${lvl[1][0]}.${lvl[1][1]}`
      out.push(`WCAG ${ver} ${lvl[2].toUpperCase()}`)
    }
  }
  return out
}

/** First failing node's selector; a node target may be nested (iframe/shadow). */
function firstTarget(nodes: unknown[]): string {
  const target = asRecord(nodes[0]).target
  if (Array.isArray(target)) return target.map((t) => (Array.isArray(t) ? t.join(' ') : str(t))).join(', ')
  return str(target)
}

/** Flatten axe `violations` → sorted issues (critical→minor, then most elements). Pure. */
export function toIssues(violations: unknown): A11yIssue[] {
  return asArray(violations)
    .map((raw): A11yIssue => {
      const r = asRecord(raw)
      const nodes = asArray(r.nodes)
      return {
        id: str(r.id),
        impact: asImpact(r.impact),
        help: str(r.help),
        helpUrl: str(r.helpUrl),
        wcag: wcagTags(r.tags),
        nodes: nodes.length,
        target: firstTarget(nodes),
      }
    })
    .filter((i) => i.id)
    .sort((a, b) => RANK[a.impact] - RANK[b.impact] || b.nodes - a.nodes || a.id.localeCompare(b.id))
}

/** Count issues by impact (all four keys always present). Pure. */
export function summarize(issues: A11yIssue[]): A11ySummary {
  const byImpact: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  for (const i of issues) byImpact[i.impact] += 1
  return { total: issues.length, byImpact }
}
