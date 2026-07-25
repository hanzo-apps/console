/**
 * Tone — the ONE semantic status→appearance map for the console chrome.
 *
 * Hanzo Cloud's chrome is MONOCHROME: the palette is a single greyscale ramp
 * (`--color1`…`--color12`, zero saturation), so a state is carried by WEIGHT, ICON
 * and LABEL — never by hue. `StatusTag` has always expressed status this way; this
 * module is the same decision made once, for every surface that was still reaching
 * for a hardcoded hex (`#3fb950` healthy, `#e5534b` failed, `#d29922` pending, …).
 *
 * Sharing a token across two tones is deliberate, not a loss: an `AlertTriangle`
 * beside "Degraded" and a `CheckCircle` beside "Healthy" are already unambiguous, so
 * colour only has to carry EMPHASIS. The ladder is:
 *
 *   critical  $color12  the brightest — the thing you must not miss
 *   warning   $color11  needs attention, does not shout
 *   positive  $color11  confirmed / healthy, reads as normal
 *   neutral   $color10  informational
 *   muted     $color9   de-emphasised (empty states, hints)
 *
 * NOT for third-party BRAND identity. A model vendor's mark (`brand-marks.ts`,
 * `brand.ts`) is that vendor's colour and stays chromatic on every brand host — it
 * is their identity, not our chrome.
 */

/** The semantic states the console expresses. */
export type Tone = 'positive' | 'warning' | 'critical' | 'neutral' | 'muted'

/**
 * `as const` keeps the literal token types (not widened to `string`) so the values
 * satisfy the GUI `color`/`bg` token unions at the call site.
 */
const TONE_COLOR = {
  critical: '$color12',
  warning: '$color11',
  positive: '$color11',
  neutral: '$color10',
  muted: '$color9',
} as const

/** The foreground token for a tone — icons, labels, values. */
export function toneColor(tone: Tone): (typeof TONE_COLOR)[Tone] {
  return TONE_COLOR[tone]
}

/**
 * Map the status vocabulary the backends actually emit onto a tone. Kept in step
 * with `StatusTag`'s `toneOf` so a pill and the icon beside it never disagree.
 * Unknown input is `neutral` — an unrecognised state is never dressed as a failure.
 */
export function toneOfStatus(status: string): Tone {
  const s = status.trim().toLowerCase()
  if (!s) return 'neutral'
  if (['error', 'failed', 'failure', 'degraded', 'down', 'canceled', 'cancelled', 'conflict', 'critical', 'red', 'suspended', 'revoked'].includes(s))
    return 'critical'
  if (['warning', 'warn', 'pending', 'queued', 'provisioning', 'building', 'deploying', 'yellow', 'throttled', 'stale'].includes(s))
    return 'warning'
  if (['ready', 'active', 'running', 'available', 'ok', 'live', 'succeeded', 'success', 'connected', 'synced', 'healthy', 'green', 'approved', 'verified', 'paid'].includes(s))
    return 'positive'
  return 'neutral'
}

/** The foreground token for a raw status string — `toneColor ∘ toneOfStatus`. */
export function statusColor(status: string): (typeof TONE_COLOR)[Tone] {
  return toneColor(toneOfStatus(status))
}
