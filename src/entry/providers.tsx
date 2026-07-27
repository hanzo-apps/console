'use client'

/**
 * The authenticated app-shell context providers, as ONE flat ordered list (not a JSX
 * pyramid). Adding or removing a provider is a one-line edit; the nesting order is
 * explicit, outer→inner. These mount ONLY at the `ready` stage — never around the
 * sign-in / waitlist / org / onboard surfaces — so their overlays (app search, chat,
 * detail pane) can never float over a takeover.
 *
 *   Scope           — the active org→project/environment scope context (lib/scope-context).
 *   PaletteRegistry — what the mounted modules contribute to ⌘K (live rows + verbs).
 *   Palette         — the one app search + command surface (Apps / ⌘K), reads the registry.
 *   HotkeyProvider  — the one keyboard layer; owns ⌘K, `/`, and every module binding.
 *   ShortcutHelp    — the `?` cheatsheet over whatever the keyboard layer holds.
 *   Chat            — the floating/docked assistant.
 *   DetailPane      — the one right-side item detail/edit pane.
 *
 * Order is load-bearing twice: Palette must sit INSIDE PaletteRegistry (it reads it),
 * and HotkeyProvider INSIDE Palette (its ⌘K default toggles it).
 *
 * (Preferences + Toast are NOT here: they sit ABOVE the stage switch — the resolver reads
 * the onboarding preference, and the onboard wizard + every module report through Toast.)
 */
import { type ComponentType, type ReactNode } from 'react'

import { Scope } from '~/lib/scope-context'
import { DetailPane } from '~/components/DetailPane'
import { Palette } from '~/components/CommandPalette'
import { PaletteRegistry } from '~/lib/palette/registry'
import { HotkeyProvider } from '~/lib/hooks/useHotkeys'
import { ShortcutHelp } from '~/components/ui/ShortcutHelp'
import { Chat } from '~/components/FloatingChat'

const READY: ComponentType<{ children: ReactNode }>[] = [
  Scope,
  PaletteRegistry,
  Palette,
  HotkeyProvider,
  ShortcutHelp,
  Chat,
  DetailPane,
]

export function Providers({ children }: { children: ReactNode }) {
  return READY.reduceRight<ReactNode>((tree, P) => <P>{tree}</P>, children)
}
