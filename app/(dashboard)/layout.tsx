import type { ReactNode } from 'react'

import { AuthGate } from '~/components/AuthGate'
import { DashboardShell } from '~/components/DashboardShell'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <DashboardShell>{children}</DashboardShell>
    </AuthGate>
  )
}
