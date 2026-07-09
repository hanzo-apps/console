import type { ReactNode } from 'react'

import { AuthGate } from '~/components/AuthGate'
import { WaitlistGate } from '~/components/WaitlistGate'
import { OrgGate } from '~/components/OrgGate'
import { DashboardShell } from '~/components/DashboardShell'
import { PreferencesProvider } from '~/lib/products/preferences'
import { ScopeProvider } from '~/lib/scope-context'
import { ToastProvider } from '~/components/ui/Toast'
import { OnboardingGate } from '~/components/onboarding/OnboardingGate'
import { CommandPaletteProvider } from '~/components/CommandPalette'
import { AppLauncherProvider } from '~/components/AppLauncher'
import { DetailPaneProvider } from '~/components/DetailPane'
import { FloatingChatProvider } from '~/components/FloatingChat'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      {/* Signed in ≠ product access. WaitlistGate renders the product only when the
          user is at the front of the waitlist (or the gate is off/open); otherwise it
          shows the waitlist panel (position + run-a-node / invite move-up paths). It
          fails open, so a waitlist blip never traps a signed-in user. */}
      <WaitlistGate>
        <OrgGate>
          <ScopeProvider>
            <PreferencesProvider>
              <ToastProvider>
                {/* First-run onboarding takes over the whole surface for a user who
                    hasn't finished it; otherwise it renders the console below. Placed
                    ABOVE the launcher/palette/chat providers so those overlays never
                    float over the wizard, but inside Preferences+Toast so the wizard
                    can persist choices and report feedback. */}
                <OnboardingGate>
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
                </OnboardingGate>
              </ToastProvider>
            </PreferencesProvider>
          </ScopeProvider>
        </OrgGate>
      </WaitlistGate>
    </AuthGate>
  )
}
