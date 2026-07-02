'use client'

/**
 * ERP — accounting, inventory, sales, purchasing, and HR on the canonical ERPNext
 * (Frappe) backend, surfaced IN the console.
 *
 * Honest by construction (verified against the live cluster + the hanzoai/erp
 * repo): there is NO ERP backend running today — erp.<brand> is 502 (a DNS/CF
 * record with no origin), and the app is a single-site Docker-Compose design that
 * isn't provisioned per org. So this module does NOT fabricate ERP data or a fake
 * "deployed" state. It probes the brand ERP host once (`/embed-status?app=erp`):
 *   - reachable → EMBED the real ERP desk (SSO iframe) in the console shell;
 *   - not reachable (today) → an honest "Deploy ERP" provision panel with a REAL
 *     provisioning request (the `/waitlist` intake), never a button that lies.
 *
 * The embed path is real and ready — when an ERP instance for the brand/org comes
 * up, the SAME gate frames it. (For the frame to render, the ERP side must also
 * allow the console origin in its `frame-ancestors`; until then the EmbeddedApp's
 * "Open full screen" is the honest fallback.) Binds to canonical ERPNext — not
 * reimplemented here.
 */
import { useCallback, useEffect, useState } from 'react'
import { Calculator, Boxes, ShoppingCart, Users } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { EmbedApi, type EmbedStatus } from '~/lib/api/embed'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { Loader } from '~/components/ui/Loader'
import { EmbeddedApp } from './embed/EmbeddedApp'
import { ProvisionPanel, type ProvisionFeature } from './embed/ProvisionPanel'

const MANAGES: ProvisionFeature[] = [
  { icon: Calculator, label: 'Accounting', body: 'General ledger, invoices, payments, and financial statements.' },
  { icon: Boxes, label: 'Inventory', body: 'Items, warehouses, stock levels, and valuation across your catalog.' },
  { icon: ShoppingCart, label: 'Sales & Buying', body: 'Sales and purchase orders, quotations, and customer/supplier records.' },
  { icon: Users, label: 'HR & Payroll', body: 'Employees, attendance, leave, and payroll on one Business-OS.' },
]

type Async = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: EmbedStatus }

export function ErpModule() {
  const [state, setState] = useState<Async>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    EmbedApi.status('erp')
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  if (state.phase === 'loading') return <Loader label="Checking ERP…" />
  if (state.phase === 'error') {
    return (
      <>
        <PageHeader title="ERP" subtitle="Accounting, inventory, and HR — your Business-OS ERP." />
        <BackendStateCard state={state.error} onRetry={load} hint="probe · GET /embed-status?app=erp" />
      </>
    )
  }

  const status = state.data

  // Entitled (brand org / global admin) AND a live ERP → embed the real desk in the
  // console shell. A customer org is `entitled:false` (server-withheld URL) and falls
  // through to the honest Deploy panel — never framed into the brand's ERP.
  if (status.entitled && status.reachable) {
    return (
      <EmbeddedApp
        title="ERP"
        subtitle="Accounting, inventory, sales, and HR — your ERPNext desk, embedded with IAM single sign-on."
        src={status.embedUrl}
        openLabel="Open ERP"
        sourceLabel="hanzoai/erp"
        note="Your ERPNext desk, signed in with your Hanzo identity (IAM SSO)."
      />
    )
  }

  // No ERP yet (today's reality) → honest deploy panel with a real provisioning request.
  return (
    <ProvisionPanel
      title="ERP"
      subtitle="Accounting, inventory, sales, and HR — your Business-OS ERP on ERPNext."
      heroTitle="Deploy Hanzo ERP"
      heroBody={
        'Hanzo ERP is the full ERPNext (Frappe) business suite — accounting, inventory, sales, ' +
        'purchasing, manufacturing, and HR — signed in with your Hanzo identity. It isn’t ' +
        'provisioned for your organization yet; request a deployment and it will appear here, ' +
        'embedded in the console.'
      }
      features={MANAGES}
      intakeSlug="erp"
      intakeLabel="ERP"
      cta="Request ERP"
      docsHref={config.docsUrl ? `${config.docsUrl}/docs/erp` : undefined}
      sourceLabel="hanzoai/erp · ERPNext (Frappe)"
      note="Binds to the canonical ERPNext backend — ERP is not reimplemented in the console."
    />
  )
}
