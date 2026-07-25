'use client'

/**
 * A wrapping row of OSS App Store cards that owns the shared deploy dialog + the maker
 * "Earn 20%" navigation — the ONE place the card's injected `onDeploy`/`onEarn` are wired,
 * reused by the full App Store grid AND the Platform home's featured strip (DRY). Purely a
 * layout + interaction shell; the caller passes the apps to show.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { XStack } from '@hanzo/gui'

import { claimPath, type OssApp } from '~/lib/api/oss-apps'
import { StoreCard } from './StoreCard'
import { DeployDialog } from './DeployDialog'

export function AppsRow({ apps, base }: { apps: OssApp[]; base: string }) {
  const router = useRouter()
  const [deploying, setDeploying] = useState<OssApp | null>(null)
  return (
    <>
      <XStack gap="$3" flexWrap="wrap">
        {apps.map((app) => (
          <StoreCard
            key={app.id}
            app={app}
            base={base}
            onDeploy={setDeploying}
            onEarn={(a) => router.push(claimPath(a))}
          />
        ))}
      </XStack>
      <DeployDialog app={deploying} onClose={() => setDeploying(null)} />
    </>
  )
}
