/**
 * Compose — turn the composer (mode + system + messages + variables + attached
 * images) into the REAL `messages` array sent to the gateway, and validate it.
 *
 * Pure + unit-tested so the "what gets sent" rules live in one tested place:
 *   - chat        → an optional system message + the ordered user/assistant turns;
 *                   uploaded images ride the LAST user turn as `image_url` content
 *                   parts (OpenAI multimodal supports SEVERAL per message), so vision —
 *                   including a MULTI-image or an IMAGE-ONLY prompt — needs no new path.
 *   - completions → a single raw user turn (no system, no extra turns, no images).
 * `{{variables}}` are substituted at build time, so the request carries resolved
 * text. An attached image counts as user content (an image-only vision prompt is
 * valid); a message with NEITHER text NOR an image yields nothing (the caller shows
 * an honest, prominent "enter a message or attach an image"), never a fabricated one.
 */
import { substitute } from './variables'
import type { ContentPart, RunMessage } from './types'

/** A composer turn (text only; images are attached separately). */
export type ComposerMsg = { role: 'user' | 'assistant'; content: string }

export type ComposeInput = {
  mode: 'chat' | 'completions'
  system: string
  messages: ComposerMsg[]
  vars: Record<string, string>
  /** Data/URLs for uploaded images, attached (all of them) to the last user turn. */
  imageUrls?: string[]
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

  const images = (input.imageUrls ?? []).filter((u) => u && u.trim())
  const lastUser = lastUserIndex(input.messages)
  input.messages.forEach((m, i) => {
    const text = sub(m.content)
    if (i === lastUser && images.length > 0) {
      // Vision: the last user turn carries its text (if any) + EVERY attached image as a
      // separate image_url part. Image-only → content is just the image parts (valid).
      const parts: ContentPart[] = []
      if (text.trim()) parts.push({ type: 'text', text })
      for (const url of images) parts.push({ type: 'image_url', image_url: { url } })
      out.push({ role: 'user', content: parts })
    } else if (text.trim()) {
      out.push({ role: m.role, content: text })
    }
  })
  return out
}

/**
 * An honest validation message for a run, or null when it can proceed. An attached image
 * counts as user content — an image-only vision prompt is valid (chat mode), so Run is
 * blocked ONLY when the message is genuinely empty (no text AND no image).
 */
export function validateRun(input: ComposeInput & { model: string }): string | null {
  if (!input.model.trim()) return 'Choose a model.'
  const built = buildRunMessages(input)
  const hasUser = built.some((m) => m.role === 'user')
  if (hasUser) return null
  if (input.mode === 'completions') return 'Enter a prompt to run.'
  return 'Enter a message or attach an image to run.'
}
