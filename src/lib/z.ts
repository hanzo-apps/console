/**
 * THE stacking ladder — the one place a layer is named.
 *
 * `app/design/z.css` has always declared this ladder (base · raised · sticky ·
 * header · dropdown · overlay · modal · popover · toast). It was read in ZERO
 * places: every overlay in the console reached for a literal instead, and the
 * literals had drifted to 1000, 1100, 9999, 100000, 100001 and 100002 — a race
 * nobody can win and nobody can reason about. Two surfaces at 100000 stacked by
 * DOM order alone.
 *
 * These are CSS `var()` strings, not numbers, so the ladder stays editable in
 * ONE stylesheet and a surface never re-states a number. React writes a string
 * z-index through verbatim; a Gui/Tamagui `zIndex` prop wants a number, so
 * layered surfaces take these on a plain `style` object (which is where every
 * one of them already was).
 *
 * Pick by ROLE, never by height. If nothing here fits, the ladder is wrong —
 * fix z.css, do not add a literal.
 */
export const Z = {
  /** Hover-lifted cards, sticky table headers, a row being dragged. */
  raised: 'var(--z-raised)',
  /** Pinned section rails. */
  sticky: 'var(--z-sticky)',
  /** The fixed shell header. */
  header: 'var(--z-header)',
  /** Menus, selects, comboboxes, the brand menu. */
  dropdown: 'var(--z-dropdown)',
  /** A dialog / sheet scrim. */
  overlay: 'var(--z-overlay)',
  /** Dialogs, sheets, drawers, the command palette, the guided-tour takeover. */
  modal: 'var(--z-modal)',
  /** Popovers and tooltips — including one anchored inside a modal, and a
   *  detail pane opened over a drawer. */
  popover: 'var(--z-popover)',
  /** Toasts / notifications — always on top. */
  toast: 'var(--z-toast)',
} as const

export type ZLayer = (typeof Z)[keyof typeof Z]
