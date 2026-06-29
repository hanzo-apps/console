import type { ReactNode } from 'react'

import { AuthGate } from '~/components/AuthGate'
import { DashboardShell } from '~/components/DashboardShell'
import { PreferencesProvider } from '~/lib/products/preferences'
import { ToastProvider } from '~/components/ui/Toast'
import { CommandPaletteProvider } from '~/components/CommandPalette'
import { AppLauncherProvider } from '~/components/AppLauncher'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <PreferencesProvider>
        <ToastProvider>
          {/* AppLauncher wraps the palette so the palette can open the launcher. */}
          <AppLauncherProvider>
            <CommandPaletteProvider>
              <DashboardShell>{children}</DashboardShell>
            </CommandPaletteProvider>
          </AppLauncherProvider>
        </ToastProvider>
      </PreferencesProvider>
    </AuthGate>
  )
}
