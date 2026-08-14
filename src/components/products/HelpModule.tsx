'use client'

/**
 * Help Center — NATIVE over the live Hanzo Framework DocType engine (/v1/framework/*),
 * NO iframe. A ticket IS a framework document tagged with module "help"; its lifecycle
 * (Open → Pending → Resolved → Closed) IS a status field; agents, teams, SLAs, and
 * canned responses are framework documents (clients/help). This module is a THIN host:
 * it routes between the SAME generic, metadata-driven DocType surfaces CMS and ERP use
 * — the collections browser, the records list, and the record detail/editor — with
 * ZERO per-doctype UI code. The Help Center is the purest DRY proof: it is fixtures
 * only (no Go hooks, no console UI), yet it renders a full support desk.
 *
 * Per-org and honest by construction: the engine resolves the org from the validated
 * bearer (via the `/v1` proxy) and enforces per-DocType permissions, so each org
 * sees + edits ONLY its own tickets/agents, and an un-set-up org sees the "Set up Help
 * Center" install CTA — never a fabricated ticket and never the old shared-desk iframe.
 */
import { useRouter } from '~/lib/router'

import { FrameworkApi } from '~/lib/framework/client'
import { CollectionsBrowser } from '~/components/doctype/CollectionsBrowser'
import { DocTypeRecords } from '~/components/doctype/DocTypeRecords'
import { DocTypeDetail } from '~/components/doctype/DocTypeDetail'

const MODULE = 'help'
const enc = encodeURIComponent

export function HelpModule({ params = {} }: { params?: Record<string, string> }) {
  const router = useRouter()
  const client = FrameworkApi
  const { doctype, name } = params

  // The registry id for this lane is 'helpdesk' (the URL prefix); the framework
  // module tag is 'help'. Keep the route prefix aligned to the registry id.
  const openCollection = (dt: string) => router.push(`/helpdesk/collections/${enc(dt)}`)
  const openRecord = (dt: string, n: string) => router.push(`/helpdesk/collections/${enc(dt)}/${enc(n)}`)

  // /helpdesk/collections/:doctype/:name → the record detail / create form.
  if (doctype && name) {
    return (
      <DocTypeDetail
        client={client}
        doctype={doctype}
        name={name}
        onBack={() => openCollection(doctype)}
        onView={(n) => openRecord(doctype, n)}
      />
    )
  }

  // /helpdesk/collections/:doctype → the records list (Tickets/Agents/Teams/…).
  if (doctype) {
    return (
      <DocTypeRecords
        client={client}
        doctype={doctype}
        onOpen={(n) => openRecord(doctype, n)}
        onCreate={() => openRecord(doctype, 'new')}
      />
    )
  }

  // /helpdesk → the DocType browser, with the setup CTA that installs the Help lane.
  return (
    <CollectionsBrowser
      client={client}
      module={MODULE}
      label="Help Center"
      subtitle="A native, metadata-driven support desk on the Hanzo Framework — tickets, agents, teams, SLAs, and canned responses as DocTypes, per organization. The ticket lifecycle is a status field on the engine; no separate helpdesk to run."
      setupDescription="The Help Center is your support desk — tickets, agents, teams, SLAs, and canned responses — as DocTypes on the Hanzo Framework, per organization. A ticket's lifecycle (Open → Pending → Resolved → Closed) is a status field."
      setupBullets={[
        'Installs the helpdesk DocTypes into your organization',
        'Tickets move through their status workflow on the framework — assigned to agents and teams',
        'Every ticket is a document on the framework — versioned, permissioned, per-org',
      ]}
      onOpen={openCollection}
    />
  )
}

