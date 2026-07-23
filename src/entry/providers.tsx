'use client'

/**
 * The authenticated app-shell context providers, as ONE flat ordered list (not a JSX
 * pyramid). Adding or removing a provider is a one-line edit; the nesting order is
 * explicit, outer→inner. These mount ONLY at the `ready` stage — never around the
 * sign-in / waitlist / org / onboard surfaces — so their overlays (launcher, ⌘K palette,
 * chat, detail pane) can never float over a takeover.
 *
 *   Scope     — the active org→project/environment scope context (lib/scope-context).
 *   Launcher  — the app-launcher grid (wraps Palette so ⌘K can open the launcher).
 *   Palette   — the ⌘K command palette.
 *   Chat      — the floating/docked assistant.
 *   DetailPane — the one right-side item detail/edit pane.
 *
 * (Preferences + Toast are NOT here: they sit ABOVE the stage switch — the resolver reads
 * the onboarding preference, and the onboard wizard + every module report through Toast.)
 */
import { type ComponentType, type ReactNode } from 'react'

import { Scope } from '~/lib/scope-context'
import { DetailPane } from '~/components/DetailPane'
import { Launcher } from '~/components/AppLauncher'
import { Palette } from '~/components/CommandPalette'
import { Chat } from '~/components/FloatingChat'

const READY: ComponentType<{ children: ReactNode }>[] = [Scope, Launcher, Palette, Chat, DetailPane]

export function Providers({ children }: { children: ReactNode }) {
  return READY.reduceRight<ReactNode>((tree, P) => <P>{tree}</P>, children)
}
