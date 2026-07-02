'use client'

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

/**
 * The authenticated dashboard chrome — AuthGate → OrgGate → shell + the console's
 * provider stack. This is the GUI/registry-heavy tree (the sidebar nav is built
 * from the product registry), so it is loaded CLIENT-ONLY via `dynamic(ssr:false)`
 * from `app/(dashboard)/layout.tsx`: the static-export prerender never evaluates
 * react-native-web server-side, and the whole authed console renders on the client
 * against the same-origin cloud `/v1` (see next.config.mjs / webui.go).
 */
export function DashboardChrome({ children }: { children: ReactNode }) {
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
