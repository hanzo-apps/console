/**
 * Hotkey strings — the pure half of the console's keyboard layer.
 *
 * A hotkey is written the way it is spoken: `'?'`, `'/'`, `'mod+k'` (⌘ on a Mac,
 * Ctrl elsewhere), or a two-key sequence `'g h'` ("go home", Linear/Vim style).
 * Parsing, event matching and glyph rendering are plain functions over plain data
 * so the engine in `useHotkeys` is only the wiring (listener, sequence timer).
 */

/** One keypress: a key, optionally with the platform's command modifier. */
export type Chord = { key: string; mod: boolean }

/** The parts of a KeyboardEvent that matching depends on. */
export type KeyEvent = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }

/**
 * `'g h'` → two chords (a sequence); `'mod+k'` → one chord with `mod`.
 * Unknown junk yields no chords, so a malformed hotkey is inert rather than
 * matching everything.
 */
export function parseHotkey(keys: string): Chord[] {
  return keys
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const bits = part.toLowerCase().split('+')
      const key = bits.pop() ?? ''
      return { key, mod: bits.includes('mod') }
    })
    .filter((c) => c.key !== '')
}

/**
 * Does `e` press `chord`? A bare key never fires while an editable element has
 * focus (typing "g" in a search box must not navigate) and never with a modifier
 * held; a `mod+` chord fires anywhere, including inside inputs — ⌘K from the
 * search box is the point of ⌘K.
 */
export function chordMatches(chord: Chord, e: KeyEvent, editable: boolean): boolean {
  if (e.altKey) return false
  const mod = Boolean(e.metaKey || e.ctrlKey)
  if (chord.mod !== mod) return false
  if (!chord.mod && editable) return false
  return e.key.toLowerCase() === chord.key
}

/** Is the event target something the user is typing into? */
export function isEditableTarget(t: unknown): boolean {
  const el = t as { tagName?: unknown; isContentEditable?: unknown } | null
  if (!el) return false
  if (el.isContentEditable === true) return true
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

const NAMED: Record<string, string> = {
  escape: 'Esc',
  enter: '↵',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space',
}

/** The glyphs to print for a hotkey string, one per key cap (`'mod+k'` → ⌘, K). */
export function glyphsFor(keys: string, mac: boolean): string[] {
  return parseHotkey(keys).flatMap((c) => {
    const cap = NAMED[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key)
    return c.mod ? [mac ? '⌘' : 'Ctrl', cap] : [cap]
  })
}
