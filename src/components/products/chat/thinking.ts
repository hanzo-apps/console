/**
 * Reasoning / chain-of-thought handling for chat bubbles — PURE, dependency-free.
 *
 * Some models stream their private reasoning inside the SAME content channel,
 * delimited by `<think>…</think>` (Zen / DeepSeek-R1 / Qwen-QwQ style). Rendered
 * raw, that trace leaks into the answer ("The user is asking me to… PONG" instead
 * of "PONG"). `splitThinking` is the ONE place that separates the final answer from
 * the reasoning, so a bubble shows only the answer with the reasoning tucked behind
 * an optional, collapsed disclosure — nothing is hidden, nothing leaks. It is
 * streaming-safe: while a `<think>` block is still open (its `</think>` hasn't
 * arrived), the in-progress reasoning is held OUT of the answer.
 */

const OPEN_TAG = /<think\b[^>]*>/i
const CLOSE_TAG = /<\/think\s*>/i

/**
 * Separate a message's final answer from any `<think>` reasoning it carries. Handles
 * three real shapes: a leading reasoning run closed by a lone `</think>` (models
 * primed with an implicit opening tag), fully-delimited `<think>…</think>` blocks
 * anywhere, and an unclosed trailing `<think>` still streaming.
 */
export function splitThinking(raw: string): { answer: string; thinking: string } {
  const thinking: string[] = []
  let s = raw

  // A leading reasoning run closed by a lone `</think>` with no opening tag.
  const firstOpen = s.search(OPEN_TAG)
  const firstClose = s.search(CLOSE_TAG)
  if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
    thinking.push(s.slice(0, firstClose).trim())
    s = s.slice(firstClose).replace(CLOSE_TAG, '')
  }

  // Fully-delimited `<think>…</think>` blocks anywhere in the remaining text.
  s = s.replace(/<think\b[^>]*>([\s\S]*?)<\/think\s*>/gi, (_m, inner: string) => {
    thinking.push(inner.trim())
    return ''
  })

  // An unclosed `<think>` still streaming — hold the tail as in-progress reasoning.
  const open = OPEN_TAG.exec(s)
  if (open) {
    thinking.push(s.slice(open.index + open[0].length).trim())
    s = s.slice(0, open.index)
  }

  return { answer: s.trim(), thinking: thinking.filter(Boolean).join('\n\n') }
}
