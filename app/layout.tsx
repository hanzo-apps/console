import '@hanzogui/core/reset.css'
import './globals.css'

import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { Provider } from '~/components/Provider'
import { ChunkGuard } from '~/components/ChunkGuard'
import { branding } from '~/config'

export const metadata: Metadata = {
  title: branding.name,
  description: 'Unified admin console for Hanzo Cloud and all cloud products.',
}

export const viewport: Viewport = {
  themeColor: '#000000',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="t_dark" style={{ backgroundColor: '#070b13', colorScheme: 'dark' }} suppressHydrationWarning>
      <body style={{ margin: 0 }}>
        <ChunkGuard />
        <Provider>{children}</Provider>
      </body>
    </html>
  )
}
