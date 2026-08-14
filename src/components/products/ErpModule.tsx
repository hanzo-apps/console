'use client'

/**
 * ERP — NATIVE over the live Hanzo Framework DocType engine (/v1/framework/*), NO
 * iframe. An ERP master (Item/Customer/Account…) IS a framework DocType tagged with
 * module "erp"; a transaction (Sales Order/Sales Invoice/Stock Entry…) IS a
 * submittable framework document with child Tables; posting (GL entries on invoice
 * submit, the stock ledger on stock-entry submit) IS a native-Go lifecycle hook on
 * the engine (clients/erp). This module is a THIN host: it routes between the SAME
 * three generic, metadata-driven DocType surfaces CMS uses — the collections
 * browser, the records list, and the record detail/editor — with ZERO per-doctype
 * UI code. The renderer + client are the DRY foundation; ERP is "that UI scoped to
 * module=erp", and the whole ERPNext-core model is data + Go hooks, not bespoke UI.
 *
 * Per-org and honest by construction: the engine resolves the org from the validated
 * bearer (via the `/v1` proxy) and enforces per-DocType permissions, so a customer
 * only ever sees + edits their OWN ERP data, and an un-set-up org sees the "Set up
 * ERP" install CTA — never a fabricated record and never the old cross-tenant desk.
 */
import { useRouter } from '~/lib/router'

import { FrameworkApi } from '~/lib/framework/client'
import { CollectionsBrowser } from '~/components/doctype/CollectionsBrowser'
import { DocTypeRecords } from '~/components/doctype/DocTypeRecords'
import { DocTypeDetail } from '~/components/doctype/DocTypeDetail'

const MODULE = 'erp'
const enc = encodeURIComponent

export function ErpModule({ params = {} }: { params?: Record<string, string> }) {
  const router = useRouter()
  const client = FrameworkApi
  const { doctype, name } = params

  const openCollection = (dt: string) => router.push(`/erp/collections/${enc(dt)}`)
  const openRecord = (dt: string, n: string) => router.push(`/erp/collections/${enc(dt)}/${enc(n)}`)

  // /erp/collections/:doctype/:name → the record detail / create form (submit/cancel
  // on a submittable transaction come from the schema — zero ERP-specific code).
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

  // /erp/collections/:doctype → the records list (table) for one DocType.
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

  // /erp → the DocType browser (Items/Customers/Sales Orders/…), with the setup CTA
  // that installs the ERP lane's DocTypes + hooks into the org.
  return (
    <CollectionsBrowser
      client={client}
      module={MODULE}
      label="ERP"
      subtitle="A native, metadata-driven ERP on the Hanzo Framework — items, warehouses, customers, sales & purchasing, accounting, and HR as DocTypes, per organization. Business logic (line totals, stock ledger, double-entry GL) runs as native hooks on the engine."
      setupDescription="ERP is your accounting, inventory, sales, purchasing, and HR model — items, warehouses, sales orders, invoices, stock entries, journal entries, and payments — as DocTypes on the Hanzo Framework, per organization."
      setupBullets={[
        'Installs the ERPNext-core DocTypes into your organization',
        'Transactions submit/cancel with real business hooks — line totals, stock ledger, and balanced GL postings',
        'Every record is a document on the framework — versioned, permissioned, per-org',
      ]}
      onOpen={openCollection}
    />
  )
}

