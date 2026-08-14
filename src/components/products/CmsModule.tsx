'use client'

/**
 * Content (CMS) — NATIVE over the live Hanzo Framework DocType engine
 * (/v1/framework/*), NO iframe. A CMS "collection" is a framework DocType tagged
 * with module "cms" (Page/Post/Article/Media/Navigation, seeded per-org by
 * `clients/cms`); a content entry is a framework document; publishing is a status
 * field. This module is a THIN host: it routes between the three generic,
 * metadata-driven DocType surfaces — the collections browser, the records
 * list/gallery, and the record detail/editor — all of which are lane-agnostic and
 * reused verbatim by ERP/Helpdesk. The renderer + client are the DRY foundation;
 * CMS is "that UI scoped to module=cms".
 *
 * Per-org and honest by construction: the engine resolves the org from the
 * validated bearer (via the `/v1` proxy) and enforces per-DocType permissions,
 * so a customer only ever sees + edits their OWN content, and an un-set-up org
 * sees the "Set up Content" install CTA — never a fabricated page.
 */
import { useRouter } from '~/lib/router'

import { FrameworkApi } from '~/lib/framework/client'
import { useScope } from '~/lib/scope-context'
import { CollectionsBrowser } from '~/components/doctype/CollectionsBrowser'
import { DocTypeRecords } from '~/components/doctype/DocTypeRecords'
import { DocTypeDetail } from '~/components/doctype/DocTypeDetail'

const MODULE = 'cms'
const enc = encodeURIComponent

export function CmsModule({ params = {} }: { params?: Record<string, string> }) {
  const router = useRouter()
  const client = FrameworkApi
  const { doctype, name } = params
  // Project as SCOPE (not a separate CMS instance): the console's org→project
  // ScopeSwitcher drives which content is shown. A selected project filters the
  // records list and is stamped onto new records — but ONLY on collections that
  // actually declare a `project` field (honest; collections without it are
  // org-level and unaffected). One engine, project is a filter.
  const { scope } = useScope()
  const project = scope.project

  const openCollection = (dt: string) => router.push(`/cms/collections/${enc(dt)}`)
  const openRecord = (dt: string, n: string) => router.push(`/cms/collections/${enc(dt)}/${enc(n)}`)

  // /cms/collections/:doctype/:name → the record detail / create form.
  if (doctype && name) {
    return (
      <DocTypeDetail
        client={client}
        doctype={doctype}
        name={name}
        project={project}
        onBack={() => openCollection(doctype)}
        onView={(n) => openRecord(doctype, n)}
      />
    )
  }

  // /cms/collections/:doctype → the records list (table) or, for a media
  // collection, the DAM gallery (DocTypeRecords picks the view from the schema).
  if (doctype) {
    return (
      <DocTypeRecords
        client={client}
        doctype={doctype}
        project={project}
        onOpen={(n) => openRecord(doctype, n)}
        onCreate={() => openRecord(doctype, 'new')}
      />
    )
  }

  // /cms → the collections browser (Media/Pages/Posts/…), with the setup + new-
  // collection affordances.
  return (
    <CollectionsBrowser
      client={client}
      module={MODULE}
      label="Content"
      subtitle="Write and publish here — pages, posts, articles, media and navigation, scoped to your organization."
      onOpen={openCollection}
    />
  )
}

