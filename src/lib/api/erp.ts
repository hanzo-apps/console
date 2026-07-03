/**
 * ERP (ERPNext/Frappe) API — the NATIVE console summary reads (Accounting / Items /
 * Sales Orders) over Frappe's REST, through the console's OWN entitlement-gated `/erp`
 * proxy (`<origin>/erp/api/resource/<DocType>`), PLUS the REAL platform deploy that
 * provisions the brand ERP app.
 *
 * We do NOT reimplement ERPNext — we read its real `/api/resource/<DocType>` lists (the
 * exact field sets verified against the erpnext v15 DocType JSON) and drive the real
 * Hanzo PaaS to deploy it. Frappe returns `{ data: [...] }`; rows are normalized
 * DEFENSIVELY. Until an ERP instance is live (today `erp.<brand>` is 502) the reads
 * error and the module shows the honest "deploy ERP" state — never fabricated ERP data.
 */
import { restGet } from './client'
import { PaasApi, type PaasApp, type PaasDeployment } from './paas'

const erpBase = (): string => (typeof window !== 'undefined' ? `${window.location.origin}/erp` : '/erp')

/** Build a Frappe list URL on the `/erp` proxy. `fields`/`filters` are JSON per Frappe. */
function resourceUrl(
  doctype: string,
  fields: string[],
  opts?: { filters?: unknown[]; orderBy?: string; limit?: number },
): string {
  const sp = new URLSearchParams()
  sp.set('fields', JSON.stringify(fields))
  if (opts?.filters) sp.set('filters', JSON.stringify(opts.filters))
  if (opts?.orderBy) sp.set('order_by', opts.orderBy)
  sp.set('limit_page_length', String(opts?.limit ?? 20))
  return `${erpBase()}/api/resource/${doctype}?${sp.toString()}`
}

// ── Defensive coercion ───────────────────────────────────────────────────────
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined
const bool = (v: unknown): boolean => v === 1 || v === true || v === '1'
const rowsOf = (payload: unknown): Record<string, unknown>[] => {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).data : payload
  return Array.isArray(data) ? (data.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []
}
const pick = (r: Record<string, unknown>, k: string): string | undefined => str(r[k])

// ── Domain types (only the summary fields shown) ─────────────────────────────

/** A ledger account (the Accounting summary — DocType `Account`). */
export type ErpAccount = {
  name: string
  accountName?: string
  rootType?: string
  accountType?: string
  currency?: string
}

/** A catalog item (the Items summary — DocType `Item`). */
export type ErpItem = {
  name: string
  itemCode?: string
  itemName?: string
  itemGroup?: string
  uom?: string
  stockItem: boolean
  disabled: boolean
  valuationRate?: number
}

/** A sales order (the Sales summary — DocType `Sales Order`). */
export type ErpSalesOrder = {
  name: string
  customer?: string
  date?: string
  grandTotal?: number
  currency?: string
  status?: string
}

// ── Normalizers (pure — exported for unit tests) ─────────────────────────────

export const normalizeAccount = (r: Record<string, unknown>): ErpAccount => ({
  name: pick(r, 'name') ?? '',
  accountName: pick(r, 'account_name'),
  rootType: pick(r, 'root_type'),
  accountType: pick(r, 'account_type'),
  currency: pick(r, 'account_currency'),
})

export const normalizeItem = (r: Record<string, unknown>): ErpItem => ({
  name: pick(r, 'name') ?? '',
  itemCode: pick(r, 'item_code'),
  itemName: pick(r, 'item_name'),
  itemGroup: pick(r, 'item_group'),
  uom: pick(r, 'stock_uom'),
  stockItem: bool(r.is_stock_item),
  disabled: bool(r.disabled),
  valuationRate: num(r.valuation_rate),
})

export const normalizeSalesOrder = (r: Record<string, unknown>): ErpSalesOrder => ({
  name: pick(r, 'name') ?? '',
  customer: pick(r, 'customer'),
  date: pick(r, 'transaction_date'),
  grandTotal: num(r.grand_total),
  currency: pick(r, 'currency'),
  status: pick(r, 'status'),
})

/** The canonical ERPNext image (the hanzoai/erp repo consumes stock frappe/erpnext). */
export const ERP_IMAGE = { repository: 'frappe/erpnext', tag: 'v15.62.0' } as const
const ERP_PROJECT = 'erp'
const ERP_APP = 'erp'

/**
 * ErpApi — native Frappe summary reads + the real deploy.
 *
 * Every read is a real `GET /api/resource/<DocType>` through the entitlement-gated
 * `/erp` proxy; the field lists mirror the erpnext v15 DocType JSON exactly. A 403
 * (not entitled), 502 (ERP not deployed), or 401 (no Frappe token) surfaces to the
 * caller's honest state — never a fabricated row.
 */
export const ErpApi = {
  accounts: (limit = 100): Promise<ErpAccount[]> =>
    restGet<unknown>(
      resourceUrl('Account', ['name', 'account_name', 'root_type', 'account_type', 'account_currency'], {
        filters: [['is_group', '=', 0]],
        limit,
      }),
    ).then((p) => rowsOf(p).map(normalizeAccount)),

  items: (limit = 50): Promise<ErpItem[]> =>
    restGet<unknown>(
      resourceUrl('Item', ['name', 'item_code', 'item_name', 'item_group', 'stock_uom', 'is_stock_item', 'disabled', 'valuation_rate'], {
        limit,
      }),
    ).then((p) => rowsOf(p).map(normalizeItem)),

  salesOrders: (limit = 50): Promise<ErpSalesOrder[]> =>
    restGet<unknown>(
      resourceUrl('Sales Order', ['name', 'customer', 'transaction_date', 'grand_total', 'currency', 'status'], {
        orderBy: 'transaction_date desc',
        limit,
      }),
    ).then((p) => rowsOf(p).map(normalizeSalesOrder)),

  /**
   * The org's ERP app on the platform, if provisioned (find in the `erp` project).
   * Returns null when no ERP app exists yet — the module shows the deploy CTA.
   */
  app: async (): Promise<PaasApp | null> => {
    const projects = await PaasApi.listProjects()
    const project = projects.find((p) => p.slug === ERP_PROJECT || p.name?.toLowerCase() === 'erp')
    if (!project) return null
    const apps = await PaasApi.listApps(project.slug || project.id)
    return apps.find((a) => a.slug === ERP_APP) ?? null
  },

  /**
   * REAL deploy — provisions the ERPNext app on Hanzo PaaS for the caller's org
   * (`/v1/platform`), idempotently: find-or-create the `erp` project + `erp` image app,
   * then trigger a deploy. Returns the real deployment record (status building/deploying/
   * …). NOTE: a full ERPNext needs its bundled data services (MariaDB/Redis) — a
   * multi-service chart the single-image platform deploy doesn't include yet — so this
   * proves the real provisioning path; the app's health reflects that reality honestly.
   */
  deploy: async (): Promise<PaasDeployment> => {
    const projects = await PaasApi.listProjects()
    let project = projects.find((p) => p.slug === ERP_PROJECT || p.name?.toLowerCase() === 'erp')
    if (!project) {
      project = await PaasApi.createProject({ name: 'ERP', slug: ERP_PROJECT, description: 'ERPNext (Frappe) business suite' })
    }
    const projKey = project.slug || project.id
    const apps = await PaasApi.listApps(projKey)
    let app = apps.find((a) => a.slug === ERP_APP)
    if (!app) {
      app = await PaasApi.createApp(projKey, {
        name: 'erp',
        slug: ERP_APP,
        environment: 'production',
        source: 'image',
        image: { repository: ERP_IMAGE.repository, tag: ERP_IMAGE.tag },
        buildType: 'image',
        port: 8080,
        replicas: 1,
      })
    }
    return PaasApi.deploy(projKey, app.slug || app.id, { tag: ERP_IMAGE.tag })
  },
}
