import '@hanzogui/core/reset.css'
import './globals.css'

import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { headers } from 'next/headers'

import { Provider } from '~/components/Provider'
import { ChunkGuard } from '~/components/ChunkGuard'
import { resolveConfig } from '~/config'

// The document <title> is SSR metadata, so it must reflect the REQUEST host's
// brand (console.lux.cloud -> "Lux Cloud Console"), not the build-time default.
// The visible shell resolves the brand client-side from window.location, but the
// tab title is server-rendered — without reading the Host header here the browser
// tab leaks "Hanzo Cloud Console" on Lux/Zoo hosts, a white-label violation.
export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host') ?? undefined
  const { brandName } = resolveConfig(host)
  return {
    title: `${brandName} Console`,
    description: 'Unified admin console for your cloud and all products.',
  }
}

export const viewport: Viewport = {
  themeColor: '#000000',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="t_dark" style={{ backgroundColor: '#000000', colorScheme: 'dark' }} suppressHydrationWarning>
      <body style={{ margin: 0 }}>
        <ChunkGuard />
        <Provider>{children}</Provider>
      </body>
    </html>
  )
}
