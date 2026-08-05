/**
 * Example prompts — curated starting points for the composer (the Examples card).
 *
 * Each is a clearly-labelled STARTER (not fabricated history): picking one fills
 * the System + User message and, when the suggested model is in the live catalog,
 * selects it. Pure data; no network. The `model` is a suggestion shown as a chip,
 * exactly like the mockup ("Explain quantum computing · zen-omni").
 */
export type Example = {
  id: string
  /** The card title. */
  label: string
  /** Suggested model id (the chip); selected on apply when it exists in the catalog. */
  model: string
  system: string
  user: string
}

export const EXAMPLES: Example[] = [
  {
    id: 'quantum',
    label: 'Explain quantum computing',
    model: 'zen-omni',
    system: 'You are a patient teacher. Explain clearly for a curious beginner.',
    user: 'Explain quantum computing in simple terms, with one everyday analogy.',
  },
  {
    id: 'debounce',
    label: 'Write a debounce function',
    model: 'zen-coder',
    system: 'You are an expert TypeScript engineer. Return only the code, no prose.',
    user: 'Write a typed debounce<T> function with a cancel() method.',
  },
  {
    id: 'summarize',
    label: 'Summarize a paragraph',
    model: 'zen-omni',
    system: 'Summarize the user text in exactly three bullet points.',
    user: 'Hanzo Cloud is a unified AI gateway exposing hundreds of models behind one OpenAI-compatible API, with built-in retrieval, billing and per-org keys, so orgs switch models without changing code.',
  },
  {
    id: 'json',
    label: 'Extract structured JSON',
    model: 'zen-omni',
    system: 'Respond with a single minified JSON object and nothing else.',
    user: 'Extract name, role and company as JSON from: "Aoi Tanaka, the CTO at Hanzo, presented today."',
  },
  {
    id: 'reasoning',
    label: 'Step-by-step reasoning',
    model: 'zen-omni',
    system: 'Think step by step, then give the final answer on its own line.',
    user: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?',
  },
  {
    id: 'sql',
    label: 'Write a SQL query',
    model: 'zen-coder',
    system: 'You are a senior data engineer. Return only the SQL.',
    user: 'Given users(id, created_at) and orders(id, user_id, total), write SQL for the top 5 users by total spend in 2026.',
  },
]
