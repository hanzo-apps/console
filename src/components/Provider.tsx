'use client'

/**
 * Root client providers: Hanzo GUI theme + next-theme (SSR-safe dark/light) +
 * the auth session context. Dark is the default theme.
 */
import { useMemo, type ReactNode } from 'react'
import { GuiProvider } from '@hanzo/gui'
import { NextThemeProvider, useRootTheme } from '@hanzogui/next-theme'
import { registerDefaultFields } from '@hanzo/data'

import config from '../../gui.config'
import { SessionProvider } from '~/lib/auth/session'
import { OrgAccentProvider } from './OrgAccentProvider'

// @hanzo/data populates its field-INPUT registry via an import SIDE EFFECT, but the
// package ships `"sideEffects": false`, so production tree-shaking (we consume it via
// `transpilePackages`) PRUNES that registration — leaving the registry empty. Then
// `FieldInput` returns null for every field, so a record CREATE/EDIT form (Base +
// Records) renders its labels with ZERO inputs and "Create" persists a BLANK row. An
// explicit call is a USED binding webpack cannot drop; it lights up every field input.
// Idempotent (guarded internally), no window/DOM — safe at module scope (SSR + client).
// ONE place, DRY — fixes every editable @hanzo/data surface, current and future.
registerDefaultFields()

function Themed({ children }: { children: ReactNode }) {
  // `dark` fallback so the server render and the client's initial state agree
  // (the html element ships `class="t_dark"`), avoiding a hydration mismatch.
  const [theme, setTheme] = useRootTheme({ fallback: 'dark' })
  const onChangeTheme = (name: string) => setTheme(name === 'light' ? 'light' : 'dark')
  return (
    <NextThemeProvider defaultTheme="dark" onChangeTheme={onChangeTheme}>
      <GuiProvider config={config} defaultTheme={theme || 'dark'}>
        {children}
      </GuiProvider>
    </NextThemeProvider>
  )
}

export function Provider({ children }: { children: ReactNode }) {
  // OrgAccentProvider lives INSIDE SessionProvider (it reads the session to resolve the
  // org's accent) and applies it at the document root — so every accent surface picks
  // up the org's brand color on load, DRY.
  const tree = useMemo(
    () => (
      <SessionProvider>
        <OrgAccentProvider />
        {children}
      </SessionProvider>
    ),
    [children],
  )
  return <Themed>{tree}</Themed>
}
