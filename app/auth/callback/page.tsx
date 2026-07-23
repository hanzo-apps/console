'use client'

/**
 * IAM OAuth callback route. The exchange logic lives in <AuthCallback/> — the SPA fallback
 * also routes `/auth/callback` through <Auth/> (which renders the same component), so
 * both entry points share the ONE handler rather than duplicating the code→token flow.
 */
import { Suspense } from 'react'

import { AuthCallback } from '~/components/AuthCallback'

export default function CallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallback />
    </Suspense>
  )
}
