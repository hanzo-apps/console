import type { ReactNode } from 'react'

import { Preferences } from '~/lib/products/preferences'
import { Toast } from '~/components/ui/Toast'
import { Entry } from '~/entry/entry'
import { Host } from '~/entry/host'

/**
 * The console entry, decomplected (see src/entry/). `Preferences` + `Toast` are the
 * session-tier context: the stage RESOLVER reads the onboarding preference, and the
 * onboard wizard + every module report through Toast — so they sit above the switch.
 * `Host` answers the two effects `@hanzo/ui/product`'s state cards ask for (sign in,
 * add credits), so every card below renders its affordance without being handed one.
 * `Entry` computes ONE stage value from the session and renders EXACTLY one surface
 * (sign-in · waitlist · org · onboard · dashboard).
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Preferences>
      <Toast>
        <Host>
          <Entry>{children}</Entry>
        </Host>
      </Toast>
    </Preferences>
  )
}
