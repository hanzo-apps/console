import './fonts.css'
import '@hanzogui/core/reset.css'
// Hanzo Design System tokens (vendored from hanzoai/design) — the monochrome
// source of truth. Imported BEFORE globals.css so the console's Tamagui theme can
// derive its ladder from the design neutral/semantic tokens.
import './design/index.css'
// The motion/skeleton classes `@hanzo/ui/product` components emit (`skeleton`,
// `row`, `tnum`, `fade-up`, `drag`). Console's own markup still names the `hz-`
// prefixed twins in globals.css below; these are the package's, and without this
// import a DataTable's skeleton, row hover and tabular figures render unstyled.
import '@hanzo/ui/styles/motion.css'
import './globals.css'

import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { headers } from 'next/headers'

import { Provider } from '~/components/Provider'
import { ChunkGuard } from '~/components/ChunkGuard'
import { BrandTitle } from '~/components/BrandTitle'
import { resolveConfig } from '~/config'
import { bootScript as appearanceBoot } from '@hanzo/appearance/state'

// The document <title> is SSR metadata, so it must reflect the REQUEST host's
// brand (console.lux.cloud -> "Lux Cloud Console"), not the build-time default.
// The visible shell resolves the brand client-side from window.location, but the
// tab title is server-rendered — without reading the Host header here the browser
// tab leaks "Hanzo Cloud Console" on Lux/Zoo hosts, a white-label violation.
//
// The description is the same metadata read by the same brand, so it resolves the
// same way. It did not, and shipped `content="Unified admin console for Hanzo Cloud
// and all cloud products."` to console.lux.cloud and console.zoo.cloud — the title
// beside it was already correct, which is exactly why nobody noticed. Every
// brand-visible string in this function comes from `brandName`; adding a literal
// here re-opens the leak.
export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host') ?? undefined
  const { brandName } = resolveConfig(host)
  return {
    title: `${brandName} Console`,
    description: `Unified admin console for ${brandName} and all cloud products.`,
  }
}

export const viewport: Viewport = {
  themeColor: '#000000',
  // Extend the layout into the display cutout / home-indicator area so the
  // `env(safe-area-inset-*)` values become non-zero on notched devices — the mobile
  // drawers + chat composer read them to keep content clear of the notch/indicator.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="t_dark" style={{ backgroundColor: '#000000', colorScheme: 'dark' }} suppressHydrationWarning>
      <head>
        {/* A person's text size and density, applied BEFORE first paint. The
            same reasoning as the literal `t_dark` class above: a preference
            read in an effect resolves after the page has painted, so every
            load would render at the default and then jump. @hanzo/appearance
            re-applies — and validates the accent — when React mounts. */}
        <script dangerouslySetInnerHTML={{ __html: appearanceBoot() }} />
      </head>
      <body style={{ margin: 0 }}>
        <ChunkGuard />
        <BrandTitle />
        <Provider>{children}</Provider>
      </body>
    </html>
  )
}
