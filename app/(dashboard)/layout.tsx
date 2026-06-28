import type { ReactNode } from 'react'

import { AuthGate } from '~/components/AuthGate'
import { DashboardShell } from '~/components/DashboardShell'
import { PreferencesProvider } from '~/lib/products/preferences'
import { ToastProvider } from '~/components/ui/Toast'
import { CommandPaletteProvider } from '~/components/CommandPalette'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <PreferencesProvider>
        <ToastProvider>
          <CommandPaletteProvider>
            <DashboardShell>{children}</DashboardShell>
          </CommandPaletteProvider>
        </ToastProvider>
      </PreferencesProvider>
    </AuthGate>
  )
}
