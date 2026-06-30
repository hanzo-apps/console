/**
 * Variables — `{{name}}` template substitution for prompts.
 *
 * The composer can reference variables in any message; the Variables editor
 * collects the names found across the system + user messages and lets you fill
 * them once. Substitution happens at Run time so the request carries the resolved
 * text. Pure + unit-tested. An unfilled variable is left verbatim (`{{name}}`)
 * rather than silently dropped — honest about what wasn't provided.
 */

const VAR_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g

/** The distinct variable names referenced in a single string, in first-seen order. */
export function extractVars(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1]
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** The distinct variable names across several strings, in first-seen order. */
export function collectVars(texts: string[]): string[] {
  const out: string[] = []
  for (const t of texts) {
    for (const name of extractVars(t)) if (!out.includes(name)) out.push(name)
  }
  return out
}

/** Replace `{{name}}` with its value; unknown names are left verbatim. */
export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(VAR_RE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
  )
}
