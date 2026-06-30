/**
 * Compose — turn the composer (mode + system + messages + variables + an optional
 * image) into the REAL `messages` array sent to the gateway, and validate it.
 *
 * Pure + unit-tested so the "what gets sent" rules live in one tested place:
 *   - chat        → an optional system message + the ordered user/assistant turns;
 *                   an uploaded image rides the LAST user turn as an `image_url`
 *                   content part (OpenAI multimodal), so vision needs no new path.
 *   - completions → a single raw user turn (no system, no extra turns).
 * `{{variables}}` are substituted at build time, so the request carries resolved
 * text. Empty content yields an empty array (the caller shows an honest "enter a
 * prompt"), never a fabricated message.
 */
import { substitute } from './variables'
import type { ContentPart, RunMessage } from './types'

/** A composer turn (text only; an image is attached separately). */
export type ComposerMsg = { role: 'user' | 'assistant'; content: string }

export type ComposeInput = {
  mode: 'chat' | 'completions'
  system: string
  messages: ComposerMsg[]
  vars: Record<string, string>
  /** A data/URL for an uploaded image, attached to the last user turn. */
  imageUrl?: string | null
}

/** Index of the last user turn, or -1. */
function lastUserIndex(messages: ComposerMsg[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i
  return -1
}

/** Build the `messages` payload for a run (variables resolved, image attached). */
export function buildRunMessages(input: ComposeInput): RunMessage[] {
  const sub = (t: string): string => substitute(t, input.vars)

  if (input.mode === 'completions') {
    const first = input.messages.find((m) => m.role === 'user')
    const text = sub(first?.content ?? '')
    return text.trim() ? [{ role: 'user', content: text }] : []
  }

  const out: RunMessage[] = []
  if (input.system.trim()) out.push({ role: 'system', content: sub(input.system) })

  const lastUser = lastUserIndex(input.messages)
  input.messages.forEach((m, i) => {
    const text = sub(m.content)
    if (i === lastUser && input.imageUrl) {
      const parts: ContentPart[] = []
      if (text.trim()) parts.push({ type: 'text', text })
      parts.push({ type: 'image_url', image_url: { url: input.imageUrl } })
      out.push({ role: 'user', content: parts })
    } else if (text.trim()) {
      out.push({ role: m.role, content: text })
    }
  })
  return out
}

/** An honest validation message for a run, or null when it can proceed. */
export function validateRun(input: ComposeInput & { model: string }): string | null {
  if (!input.model.trim()) return 'Choose a model.'
  const built = buildRunMessages(input)
  const hasUser = built.some((m) => m.role === 'user')
  if (!hasUser) return input.mode === 'completions' ? 'Enter a prompt.' : 'Enter a user message.'
  return null
}
