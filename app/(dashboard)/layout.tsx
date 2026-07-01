import type { ReactNode } from 'react'

import { AuthGate } from '~/components/AuthGate'
import { OrgGate } from '~/components/OrgGate'
import { DashboardShell } from '~/components/DashboardShell'
import { PreferencesProvider } from '~/lib/products/preferences'
import { ScopeProvider } from '~/lib/scope-context'
import { ToastProvider } from '~/components/ui/Toast'
import { CommandPaletteProvider } from '~/components/CommandPalette'
import { AppLauncherProvider } from '~/components/AppLauncher'
import { DetailPaneProvider } from '~/components/DetailPane'
import { FloatingChatProvider } from '~/components/FloatingChat'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <OrgGate>
        <ScopeProvider>
          <PreferencesProvider>
            <ToastProvider>
              {/* AppLauncher wraps the palette so the palette can open the launcher. */}
              <AppLauncherProvider>
                <CommandPaletteProvider>
                  {/* FloatingChat floats the assistant bubble over every page. */}
                  <FloatingChatProvider>
                    {/* DetailPane hosts the ONE right-side item detail/edit pane. */}
                    <DetailPaneProvider>
                      <DashboardShell>{children}</DashboardShell>
                    </DetailPaneProvider>
                  </FloatingChatProvider>
                </CommandPaletteProvider>
              </AppLauncherProvider>
            </ToastProvider>
          </PreferencesProvider>
        </ScopeProvider>
      </OrgGate>
    </AuthGate>
  )
}
