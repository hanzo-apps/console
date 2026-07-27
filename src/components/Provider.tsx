'use client'

/**
 * Root client providers: Hanzo GUI theme + next-theme (SSR-safe dark/light) +
 * the auth session context. Dark is the default theme.
 */
import { useMemo, type ReactNode } from 'react'
import { GuiProvider } from '@hanzo/gui'
import { NextThemeProvider, useRootTheme } from '@hanzogui/next-theme'
import { registerDefaultFields, registerField } from '@hanzo/data'
import { AnalyticsProvider } from '@hanzo/event/react'
import { IamProvider } from '@hanzo/iam/react'
import { HostProvider } from '@hanzo/ui/product'

import config from '../../gui.config'
import { SessionProvider } from '~/lib/auth/session'
import { iamConfig, startReauth } from '~/lib/auth/iam'
import { EntitlementsProvider } from '~/lib/entitlements-context'
import { AnalyticsBridge } from './Analytics'
import { OrgAccentProvider } from './OrgAccentProvider'
import { RichTextDisplay, RichTextInput } from './fields/RichTextField'

// @hanzo/data populates its field-INPUT registry via an import SIDE EFFECT, but the
// package ships `"sideEffects": false`, so production tree-shaking (we consume it via
// `transpilePackages`) PRUNES that registration — leaving the registry empty. Then
// `FieldInput` returns null for every field, so a record CREATE/EDIT form (Base +
// Records) renders its labels with ZERO inputs and "Create" persists a BLANK row. An
// explicit call is a USED binding webpack cannot drop; it lights up every field input.
// Idempotent (guarded internally), no window/DOM — safe at module scope (SSR + client).
// ONE place, DRY — fixes every editable @hanzo/data surface, current and future.
registerDefaultFields()

// Upgrade the `richText` field from @hanzo/data's plain-textarea fallback to the
// native Lexical WYSIWYG (bold/italic/headings/lists/links/quote + read-mode HTML).
// `registerField` OVERRIDES the default in place — one dispatch point, so every
// `richText` field (a CMS Article/Page body, any DocType/collection field typed
// RichText) renders the real editor. Lexical is a console concern, not a data-layer
// one, so it's registered here rather than forking @hanzo/data.
registerField('richText', { Display: RichTextDisplay, Input: RichTextInput })

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
  // @hanzo/ui/product is presentational — it never imports a router or an auth
  // module. Its honest-state cards get the console's two effects from here, once.
  const tree = useMemo(
    () => (
      <IamProvider config={iamConfig()}>
      <HostProvider actions={{ signIn: startReauth, addCredits: () => { window.location.href = '/billing/credits' } }}>
      <SessionProvider>
        <OrgAccentProvider />
        {/* Entitlements live inside the session (they read the signed-in account +
            active org scope) so the sidebar/launcher/palette gate from ONE fetch. */}
        <EntitlementsProvider>
          {/* Analytics lives INSIDE the session so `identify` binds the signed-in
              actor; cookie/same-origin mode (the tenant is stamped server-side), so
              only the product is configured. `AnalyticsBridge` wires pageviews +
              identity. */}
          <AnalyticsProvider config={{ product: 'console' }}>
            <AnalyticsBridge />
            {children}
          </AnalyticsProvider>
        </EntitlementsProvider>
      </SessionProvider>
      </HostProvider>
      </IamProvider>
    ),
    [children],
  )
  return <Themed>{tree}</Themed>
}
