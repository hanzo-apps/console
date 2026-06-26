import type { ReactNode } from 'react'

import { AuthGate } from '~/components/AuthGate'
import { DashboardShell } from '~/components/DashboardShell'
import { PreferencesProvider } from '~/lib/products/preferences'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <PreferencesProvider>
        <DashboardShell>{children}</DashboardShell>
      </PreferencesProvider>
    </AuthGate>
  )
}
