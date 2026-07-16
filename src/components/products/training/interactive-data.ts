/**
 * Parse the interactive-training "train box" textarea into engine `Datum` rows.
 *
 * One JSON object per non-empty line (JSONL): either a `{prompt, completion}` pair or a
 * pre-tokenized `{model_input:{tokens:[]}, target_tokens:[], weights?:[]}` row. Pure +
 * side-effect-free so it unit-tests in the node env; returns an honest per-line error
 * (never throws) so the UI can point at the offending line instead of silently dropping it.
 */
import type { Datum } from '~/lib/api/training'

export function parseTrainingData(text: string): { data: Datum[]; error?: string } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return { data: [], error: 'Add at least one prompt→completion row.' }

  const data: Datum[] = []
  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown
    try {
      parsed = JSON.parse(lines[i])
    } catch {
      return { data: [], error: `Line ${i + 1} is not valid JSON.` }
    }
    const r = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}

    if (typeof r.prompt === 'string' && typeof r.completion === 'string') {
      data.push({ prompt: r.prompt, completion: r.completion })
      continue
    }
    const mi = r.model_input as { tokens?: unknown } | undefined
    if (mi && Array.isArray(mi.tokens) && Array.isArray(r.target_tokens)) {
      data.push(parsed as Datum)
      continue
    }
    return {
      data: [],
      error: `Line ${i + 1} needs {"prompt","completion"} or {"model_input":{"tokens":[…]},"target_tokens":[…]}.`,
    }
  }
  return { data }
}
