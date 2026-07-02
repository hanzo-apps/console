'use client'

/**
 * Content — the REAL, live Hanzo Content Studio (a Payload headless CMS, deployed at
 * cms.<brand> and confirmed live at cms.hanzo.ai/admin) rendered IN the console.
 *
 * This is NOT a link-out anymore: for the org that OWNS the Studio the admin is
 * EMBEDDED (SSO iframe) inside the console shell, so it reads as a native console
 * product — the sidebar, top bar, and breadcrumb stay, and the user never leaves
 * console.<brand>. The Studio is wired to the brand IAM (JWKS + trusted proxy), so
 * it opens signed-in with the same identity the console already holds; the console
 * injects no credential.
 *
 * Honest tenancy (verified — the modules encode reality, not a wish): the Studio is
 * today a SINGLE shared per-BRAND instance (`HANZO_ORG=hanzo`), NOT per-customer-org.
 * So entitlement is decided SERVER-SIDE by `/embed-status` (the token owner must be
 * the brand org, or a global admin); a CUSTOMER org receives `entitled:false` and NO
 * embed URL, and sees an honest "a Studio for your org isn't provisioned yet" panel —
 * it is never framed into the brand's content. When a per-org Studio exists the SAME
 * gate embeds it. White-label: cms.<brand> is derived from the host. Binds to the
 * canonical Payload backend — it is not reimplemented here.
 */
import { useCallback, useEffect, useState } from 'react'
import { FileText, Image as ImageIcon, Newspaper, Globe } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { EmbedApi, type EmbedStatus } from '~/lib/api/embed'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { Loader } from '~/components/ui/Loader'
import { EmbeddedApp } from './embed/EmbeddedApp'
import { ProvisionPanel, type ProvisionFeature } from './embed/ProvisionPanel'

const MANAGES: ProvisionFeature[] = [
  { icon: FileText, label: 'Pages', body: 'Structured, versioned pages that render your marketing and product site.' },
  { icon: Newspaper, label: 'Posts', body: 'Blog and changelog entries with drafts, scheduling, and a publish workflow.' },
  { icon: ImageIcon, label: 'Media', body: 'A managed media library — uploads, focal points, and responsive variants.' },
  { icon: Globe, label: 'Globals', body: 'Site-wide navigation, footer, and settings shared across every surface.' },
]

type Async = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: EmbedStatus }

export function CmsModule() {
  const [state, setState] = useState<Async>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    EmbedApi.status('cms')
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  if (state.phase === 'loading') return <Loader label="Loading Content Studio…" />
  if (state.phase === 'error') {
    return (
      <>
        <PageHeader title="Content" subtitle="Your Content Studio — a headless CMS for pages, posts, and media." />
        <BackendStateCard state={state.error} onRetry={load} hint="probe · GET /embed-status?app=cms" />
      </>
    )
  }

  const status = state.data

  // Not entitled (a customer org): honest provision panel — NEVER an embed of the
  // brand's shared content. The server already withheld the embed URL.
  if (!status.entitled) {
    return (
      <ProvisionPanel
        title="Content"
        subtitle="A headless CMS for your pages, posts, and media — with IAM single sign-on."
        heroTitle="Content Studio for your organization"
        heroBody={
          'The Content Studio is a block-based headless CMS (Payload) for pages, posts, and media, ' +
          'served over a versioned content API. Today it runs as a shared per-brand Studio, so a ' +
          'dedicated Studio for your organization isn’t provisioned yet — request one and it will ' +
          'appear here, embedded and signed in with your Hanzo identity.'
        }
        features={MANAGES}
        intakeSlug="cms"
        intakeLabel="Content Studio"
        cta="Request Studio"
        docsHref={config.docsUrl ? `${config.docsUrl}/docs/cms` : undefined}
        sourceLabel="hanzoai/cms · Payload headless CMS"
        note="Binds to the canonical Payload backend — the CMS is not reimplemented in the console."
      />
    )
  }

  // Entitled (brand org / global admin) and the Studio is live → embed it.
  if (status.reachable) {
    return (
      <EmbeddedApp
        title="Content"
        subtitle="Your Content Studio — a headless CMS for pages, posts, and media, embedded with IAM single sign-on."
        src={status.embedUrl}
        openLabel="Open Studio"
        sourceLabel="hanzoai/cms"
        note="Your brand’s Content Studio, signed in with your Hanzo identity (IAM SSO)."
      />
    )
  }

  // Entitled but the Studio host isn't answering — honest "unavailable".
  return (
    <>
      <PageHeader title="Content" subtitle="Your Content Studio — a headless CMS for pages, posts, and media." />
      <BackendStateCard
        state={{ kind: 'unavailable', message: `The Content Studio (${status.origin}) is not reachable right now.` }}
        onRetry={load}
        hint={`host · ${status.origin}`}
      />
    </>
  )
}
