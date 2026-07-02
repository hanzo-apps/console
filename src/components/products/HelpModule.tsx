'use client'

/**
 * Help Center — the live Hanzo Help Center (a Frappe Helpdesk, deployed at
 * help.<brand> and confirmed live at help.hanzo.ai) rendered IN the console.
 *
 * Not a link-out: the Help Center is EMBEDDED (SSO iframe) inside the console
 * shell, so submitting a ticket or reading the knowledge base never leaves
 * console.<brand>. It is wired to the brand IAM as a Frappe social login
 * ("Login with hanzo", client_id `<brand>-helpdesk`), so it opens signed-in with
 * the same identity the console holds. This is a SHARED brand support desk — the
 * Helpdesk scopes each caller to THEIR OWN tickets server-side (plus the public
 * knowledge base), so it is embedded for every signed-in user (no per-org gate,
 * and no cross-tenant surface). White-label: help.<brand> is derived from the host.
 *
 * Honest: if the Help host isn't reachable it shows a truthful "not available"
 * state — never a fabricated help surface. Binds to the canonical Frappe Helpdesk.
 */
import { useCallback, useEffect, useState } from 'react'

import { EmbedApi, type EmbedStatus } from '~/lib/api/embed'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { Loader } from '~/components/ui/Loader'
import { EmbeddedApp } from './embed/EmbeddedApp'

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
  if (status.reachable) {
    return (
      <EmbeddedApp
        title="Help Center"
        subtitle="Support tickets and a knowledge base — embedded with IAM single sign-on."
        src={status.embedUrl}
        openLabel="Open Help Center"
        sourceLabel="hanzoai/helpdesk"
        note="The Hanzo Help Center, signed in with your Hanzo identity (IAM SSO); you see your own tickets."
      />
    )
  }

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
