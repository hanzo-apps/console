'use client'

/**
 * `/docs` → the brand documentation site (docs.hanzo.ai / docs.lux.network / …),
 * resolved CLIENT-side (task #41, "True 1-binary FE").
 *
 * Docs are an EXTERNAL product on their own domain, never an in-app route — so a
 * typed or bookmarked `<console-host>/docs` must land on the real docs, not the
 * catch-all not-found. The old app/docs/route.ts issued a server 308; in the
 * one-binary there is no Next runtime (the static export has no server, and a static
 * export cannot rewrite), so the redirect is resolved from the per-host brand
 * (`config.docsUrl`) in the browser — exactly what the sidebar "Docs" link and the
 * header "?" already open. One way, both topologies (embed + standalone).
 *
 * The target is set in an effect (not during render) so there is no SSR/CSR
 * hydration mismatch on the per-brand host between the build-time default and the
 * real browser host.
 */
import { useEffect, useState } from 'react'

import { config } from '~/config'

export default function DocsRedirect() {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const target = config.docsUrl
    setUrl(target)
    window.location.replace(target)
  }, [])
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      Opening documentation… {url ? <a href={url}>Open the docs site</a> : null}
    </main>
  )
}
