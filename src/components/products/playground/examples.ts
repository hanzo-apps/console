/**
 * Example prompts — one-click starting points for the compare board. Picking an
 * example fills the shared System + User so the SAME prompt fans out to every
 * selected model. Pure data; no network, nothing fabricated about model output.
 */
export type Example = {
  id: string
  label: string
  description: string
  system: string
  user: string
}

export const EXAMPLES: Example[] = [
  {
    id: 'reasoning',
    label: 'Step-by-step reasoning',
    description: 'A classic trap question — compare how models reason.',
    system: 'You are a careful reasoner. Think step by step, then give the final answer on its own line.',
    user: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?',
  },
  {
    id: 'code',
    label: 'Write code',
    description: 'A small coding task — compare code quality and style.',
    system: 'You are an expert TypeScript engineer. Return only the code, no prose.',
    user: 'Write a debounce function in TypeScript with correct types and a cancel method.',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    description: 'Condense a paragraph — compare faithfulness and concision.',
    system: 'Summarize the user text in exactly three bullet points.',
    user: 'Hanzo Cloud is a unified AI gateway exposing 40+ models behind one OpenAI-compatible API, with built-in retrieval, billing, and per-org keys, so teams can switch models without changing code.',
  },
  {
    id: 'json',
    label: 'Structured output',
    description: 'Strict JSON — compare instruction-following.',
    system: 'Respond with a single minified JSON object and nothing else.',
    user: 'Extract name, role and company as JSON from: "Aoi Tanaka, the CTO at Hanzo, presented today."',
  },
  {
    id: 'creative',
    label: 'Creative writing',
    description: 'A short creative task — compare tone and voice.',
    system: 'You are a concise, vivid writer.',
    user: 'Write a two-sentence sci-fi story about a lighthouse on a gas giant.',
  },
]
