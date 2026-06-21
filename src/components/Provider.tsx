'use client'

/**
 * Root client providers: Hanzo GUI theme + next-theme (SSR-safe dark/light) +
 * the auth session context. Dark is the default theme.
 */
import { useMemo, type ReactNode } from 'react'
import { GuiProvider } from '@hanzo/gui'
import { NextThemeProvider, useRootTheme } from '@hanzogui/next-theme'

import config from '../../gui.config'
import { SessionProvider } from '~/lib/auth/session'

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
  const tree = useMemo(() => <SessionProvider>{children}</SessionProvider>, [children])
  return <Themed>{tree}</Themed>
}
