/**
 * The @hanzo/gui 8 props that a gui 7 spelling silently replaces with nothing.
 *
 * gui accepts any prop and drops the ones it does not recognise — no error, no type
 * failure, no warning. A renamed prop therefore type-checks, builds, ships, and does
 * nothing. That is not a hypothetical: `tag="a"` shipped in this console as a <div>,
 * so a Cloudflare URL chip and every contact channel card (mailto included) were dead
 * links that no build, no test, and no type-check could have reported.
 *
 * The type system provably cannot gate this, so the gate is the source text. Each rule
 * below was VERIFIED against the renderer (scripts/gui-prop-probe.mjs — it renders the
 * prop and reads the host element and emitted class back out), never inferred from
 * docs:
 *
 *   tag="a"                 -> <div tag="a">            DROPPED   (render="a" -> <a>)
 *   animation="quick"       -> <div animation="quick">  DROPPED   (transition="quick")
 *   $gtSm={{…}}             -> no class + a React DOM warning     ($sm — v5 media is
 *                                                                 mobile-first, so a
 *                                                                 bare name IS min-width)
 *   lineHeight={1.1}        -> line-height: 1.1px       WRONG     (a ratio is not a
 *                                                                 length; gui appends
 *                                                                 px to a bare number
 *                                                                 in a prop AND in
 *                                                                 `style`, so a ratio
 *                                                                 must be the string
 *                                                                 '1.1')
 *
 * `letterSpacing` is deliberately NOT banned: verified working as a prop for both a
 * unit string ("-0.02em" -> _ls--0--02em) and a bare number (px, which is what this
 * codebase's 0.4/-0.5 tracking values mean). Only a CSS `var()` fails there, because
 * gui types the prop against its own token namespace — that one rides `style`.
 */

/** One banned gui 7 spelling: what to match, what it silently does, what to write. */
export type Gui8Rule = {
  /** Human name of the banned spelling. */
  readonly prop: string
  /** Matches the banned spelling in source text. Must be global. */
  readonly pattern: RegExp
  /** What gui actually renders when it meets the banned spelling. */
  readonly renders: string
  /** The gui 8 spelling to use instead. */
  readonly instead: string
}

/**
 * The host elements a gui `tag`/`render` can name.
 *
 * Narrowed to real element names on purpose: `tag` is also an ordinary DATA field in
 * this codebase (a container image tag, `{ tag: 'v1' }`), and a rule that cannot tell
 * an element from an image version is a rule that gets deleted the first time it cries
 * wolf. Every host element the org actually renders is here.
 */
const HOST_ELEMENTS = 'a|p|main|section|article|aside|nav|header|footer|h1|h2|h3|h4|h5|h6|ul|ol|li|label|form|figure|blockquote|span|div'

export const GUI8_RULES: readonly Gui8Rule[] = [
  {
    prop: 'tag',
    // `tag="a"` and `{ tag: 'a' }` — the prop and object-spread forms.
    pattern: new RegExp(`\\btag=(?:"|')(?:${HOST_ELEMENTS})(?:"|')|\\btag:\\s*(?:"|')(?:${HOST_ELEMENTS})(?:"|')`, 'g'),
    renders: 'a <div> with a stray tag="…" DOM attribute — the element is inert',
    instead: 'render',
  },
  {
    prop: 'animation',
    pattern: /\banimation=(?:"|'|\{)/g,
    renders: 'a stray animation="…" DOM attribute and no easing at all',
    instead: 'transition',
  },
  {
    prop: '$gt* breakpoints',
    pattern: /\$gt[A-Z][a-zA-Z]*\s*=?\s*\{/g,
    renders: 'no class at all, plus a React "unrecognized prop" DOM warning',
    instead: '$sm / $md / $lg (v5 media is mobile-first: a bare name IS the min-width)',
  },
  {
    prop: 'lineHeight ratio',
    // A bare decimal (1.1, 1.25) is a RATIO. A bare integer (22) is a legitimate px
    // length, so only the decimal form is banned.
    pattern: /\blineHeight=\{\s*\d+\.\d+\s*\}|\blineHeight:\s*\d+\.\d+\b/g,
    renders: 'line-height: 1.1px — every line of a wrapped title on one baseline',
    instead: "the string form (lineHeight=\"1.1\"), so it reaches CSS unitless",
  },
]

/** Where a banned spelling was found. */
export type Gui8Violation = { readonly rule: Gui8Rule; readonly match: string; readonly line: number }

/**
 * Every banned gui 7 spelling in one file's source text.
 *
 * Line-based so a report points at the offending line, and so a `//`-prefixed line is
 * skipped: these props are named in prose (this module, the fix comments at the two
 * call sites) far more often than they are written, and a doc comment that cannot
 * mention the bug it documents is a worse rule than none.
 */
export function findGui8Violations(source: string): Gui8Violation[] {
  const out: Gui8Violation[] = []
  source.split('\n').forEach((text, i) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(text)) return
    for (const rule of GUI8_RULES) {
      for (const m of text.matchAll(rule.pattern)) out.push({ rule, match: m[0], line: i + 1 })
    }
  })
  return out
}
