'use client'

/**
 * Help Center — the live Hanzo Help Center (a Frappe Helpdesk, deployed at
 * help.<brand> and confirmed live at help.hanzo.ai) rendered IN the console.
 *
 * Not a link-out: for the org that OWNS it, the Help Center is EMBEDDED (SSO iframe)
 * inside the console shell, so submitting a ticket or reading the knowledge base
 * never leaves console.<brand>. It is wired to the brand IAM as a Frappe social login
 * ("Login with hanzo", client_id `<brand>-helpdesk`), so it opens signed-in with the
 * same identity the console holds.
 *
 * Honest tenancy (verified): the Help Center is today a SINGLE shared per-BRAND
 * Frappe Helpdesk (`HANZO_ORG=hanzo`), NOT per-customer-org. Ticket confidentiality
 * on a shared desk rests on the Helpdesk's own role mapping, which the console can't
 * verify — so rather than trust that blind, entitlement is decided SERVER-SIDE by
 * `/embed-status` (brand org / global admin only). A CUSTOMER org receives
 * `entitled:false` and NO embed URL, and sees an honest "a Help Center for your org
 * isn't provisioned yet" panel — it is never framed into the brand's support desk.
 * When a per-org Help Center exists the SAME gate embeds it. Binds to the canonical
 * Frappe Helpdesk — not reimplemented here.
 */
import { useCallback, useEffect, useState } from 'react'
import { LifeBuoy, BookOpen, Inbox, Clock } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { EmbedApi, type EmbedStatus } from '~/lib/api/embed'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { Loader } from '~/components/ui/Loader'
import { EmbeddedApp } from './embed/EmbeddedApp'
import { ProvisionPanel, type ProvisionFeature } from './embed/ProvisionPanel'

const MANAGES: ProvisionFeature[] = [
  { icon: Inbox, label: 'Tickets', body: 'A shared inbox for customer requests, with assignment, status, and replies.' },
  { icon: BookOpen, label: 'Knowledge Base', body: 'Public help articles your customers can search before they file a ticket.' },
  { icon: Clock, label: 'SLAs', body: 'Response and resolution targets, with escalation when they’re at risk.' },
  { icon: LifeBuoy, label: 'Portal', body: 'A branded self-service portal where users track their own requests.' },
]

type Async = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: EmbedStatus }

export function HelpModule() {
  const [state, setState] = useState<Async>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    EmbedApi.status('help')
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  if (state.phase === 'loading') return <Loader label="Loading Help Center…" />
  if (state.phase === 'error') {
    return (
      <>
        <PageHeader title="Help Center" subtitle="Support tickets and a knowledge base for your users." />
        <BackendStateCard state={state.error} onRetry={load} hint="probe · GET /embed-status?app=help" />
      </>
    )
  }

  const status = state.data

  // Not entitled (a customer org): honest provision panel — NEVER an embed of the
  // brand's shared support desk (which would risk cross-org ticket visibility).
  if (!status.entitled) {
    return (
      <ProvisionPanel
        title="Help Center"
        subtitle="A customer helpdesk — tickets and a knowledge base for your users, with IAM single sign-on."
        heroTitle="Help Center for your organization"
        heroBody={
          'The Help Center is a Frappe Helpdesk — a shared ticket inbox, SLAs, and a searchable ' +
          'knowledge base for your users. Today it runs as a shared per-brand desk, so a dedicated ' +
          'Help Center for your organization isn’t provisioned yet — request one and it will appear ' +
          'here, embedded and signed in with your Hanzo identity.'
        }
        features={MANAGES}
        intakeSlug="helpdesk"
        intakeLabel="Help Center"
        cta="Request Help Center"
        docsHref={config.docsUrl ? `${config.docsUrl}/docs/helpdesk` : undefined}
        sourceLabel="hanzoai/helpdesk · Frappe Helpdesk"
        note="Binds to the canonical Frappe Helpdesk — the Help Center is not reimplemented in the console."
      />
    )
  }

  // Entitled (brand org / global admin) and the desk is live → embed it.
  if (status.reachable) {
    return (
      <EmbeddedApp
        title="Help Center"
        subtitle="Support tickets and a knowledge base — embedded with IAM single sign-on."
        src={status.embedUrl}
        openLabel="Open Help Center"
        sourceLabel="hanzoai/helpdesk"
        note="Your brand’s Help Center, signed in with your Hanzo identity (IAM SSO)."
      />
    )
  }

  // Entitled but the desk isn't answering — honest "unavailable".
  return (
    <>
      <PageHeader title="Help Center" subtitle="Support tickets and a knowledge base for your users." />
      <BackendStateCard
        state={{ kind: 'unavailable', message: `The Help Center (${status.origin}) is not reachable right now.` }}
        onRetry={load}
        hint={`host · ${status.origin}`}
      />
    </>
  )
}
