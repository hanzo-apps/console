import type { ReactNode } from 'react'

import { Preferences } from '~/lib/products/preferences'
import { Toast } from '~/components/ui/Toast'
import { Entry } from '~/entry/entry'

/**
 * The console entry, decomplected (see src/entry/). `Preferences` + `Toast` are the
 * session-tier context: the stage RESOLVER reads the onboarding preference, and the
 * onboard wizard + every module report through Toast — so they sit above the switch.
 * `Entry` computes ONE stage value from the session and renders EXACTLY one surface
 * (sign-in · waitlist · org · onboard · dashboard).
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Preferences>
      <Toast>
        <Entry>{children}</Entry>
      </Toast>
    </Preferences>
  )
}
