'use client'

/**
 * The Commerce (Store) category pages — the merchant dashboard inside the console, over
 * the canonical Hanzo Commerce backend (`hanzoai/commerce`, Go, per-org SQLite — NOT
 * Medusa). Every row is REAL commerce data for the SIGNED-IN ORG: the `/commerce`
 * user-bearer proxy mints a short-lived IAM token and commerce's EdgeAuth resolves the
 * org from its `owner` claim, so a merchant only ever sees/edits their OWN org's store
 * (server-side; the org can never be widened from the client). An empty store shows the
 * honest empty copy — never a placeholder.
 *
 * Products is a full CRUD surface (create + list + delete over `/v1/product`); Orders /
 * Customers / Inventory / Promotions are real read lists on the shared `CommerceResource`;
 * Store settings reads the org's real storefront config (`/v1/store/current`). Money
 * stays in Billing (Square via commerce `/v1/billing`) — these pages are the catalog/
 * order/customer surface only.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink, Plus, RefreshCw, Trash2 } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { CommerceApi } from '~/lib/api/commerce'
import type {
  CommerceProduct,
  CommerceOrder,
  CommerceCustomer,
  CommerceVariant,
  CommerceDiscount,
  CommerceStore,
} from '~/lib/api/commerce'
import { fmtUsd, fmtInt, fmtAbs } from '~/lib/api/functions'
import { DataTable, type Column } from '@hanzo/ui/product'
import { FieldRow, FieldText } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { PageHeader } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { CommerceResource } from './CommerceResource'
import { discountValue, humanizeStatus } from './logic'

const Cell = ({ children }: { children: ReactNode }) => (
  <Text fontSize="$3" color="$color11" numberOfLines={1}>
    {children}
  </Text>
)
const Strong = ({ children }: { children: ReactNode }) => (
  <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
    {children}
  </Text>
)
const Dash = () => (
  <Text fontSize="$3" color="$color10">
    —
  </Text>
)

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

// ── Products (full CRUD — create + list + delete) ─────────────────────────────
const productStatus = (p: CommerceProduct): string =>
  p.hidden ? 'hidden' : p.available ? 'available' : 'unavailable'

/** Per-row delete — confirms, runs `CommerceApi.deleteProduct`, then reloads. */
function ProductDelete({ product, onDeleted }: { product: CommerceProduct; onDeleted: () => void }) {
  const [working, setWorking] = useState(false)
  return (
    <Button
      size="$2"
      chromeless
      aria-label={`Delete ${product.name}`}
      disabled={working}
      icon={<Trash2 size={15} />}
      onPress={async () => {
        if (typeof window !== 'undefined' && !window.confirm(`Delete ${product.name}? This cannot be undone.`)) return
        setWorking(true)
        try {
          await CommerceApi.deleteProduct(product.id)
          onDeleted()
        } finally {
          setWorking(false)
        }
      }}
    />
  )
}

function ProductForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [slug, setSlug] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  const submit = async () => {
    // Commerce's product validator requires name, sku, AND slug (product_v2.go).
    const n = name.trim()
    const s = sku.trim()
    const g = slug.trim() || slugify(n)
    if (!n || !s || !g) {
      setError({ kind: 'error', message: 'Name, SKU, and slug are all required.' })
      return
    }
    setWorking(true)
    setError(null)
    try {
      await CommerceApi.createProduct({ name: n, sku: s, slug: g, available: true })
      onDone()
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={760} mb="$3">
      {error ? <BackendStateCard state={error} hint="endpoint · POST /v1/product (Hanzo Commerce)" /> : null}
      <FieldRow label="Name"><FieldText value={name} onChange={setName} placeholder="MaxPower Logo Tee" /></FieldRow>
      <FieldRow label="SKU"><FieldText value={sku} onChange={setSku} placeholder="MP-TEE-001" /></FieldRow>
      <FieldRow label="Slug"><FieldText value={slug} onChange={setSlug} placeholder="auto from name" /></FieldRow>
      <Button self="flex-start" icon={<Plus size={15} />} disabled={working} onPress={() => void submit()}>
        {working ? 'Creating…' : 'Create product'}
      </Button>
    </Card>
  )
}

export function StoreProductsModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<Async<CommerceProduct[]>>({ phase: 'loading' })
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CommerceApi.products()
      .then((r) => setState({ phase: 'ready', data: r.rows }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const columns: Column<CommerceProduct>[] = [
    { key: 'name', header: 'Product', render: (r) => <Strong>{r.name}</Strong> },
    { key: 'sku', header: 'SKU', width: 150, render: (r) => (r.sku ? <Cell>{r.sku}</Cell> : <Dash />) },
    { key: 'price', header: 'Price', width: 110, render: (r) => <Cell>{fmtUsd(r.priceCents)}</Cell> },
    { key: 'inventory', header: 'Stock', width: 90, render: (r) => <Cell>{fmtInt(r.inventory)}</Cell> },
    { key: 'status', header: 'Status', width: 130, render: (r) => <StatusTag status={productStatus(r)} /> },
    { key: 'created', header: 'Created', width: 180, render: (r) => <Cell>{fmtAbs(r.createdAt)}</Cell> },
    { key: 'actions', header: '', width: 56, render: (r) => <ProductDelete product={r} onDeleted={load} /> },
  ]

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Your store's catalog — items customers can buy. Managed in Hanzo Commerce, scoped to your organization."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<Plus size={15} />} onPress={() => setCreating((v) => !v)}>New product</Button>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>
          </XStack>
        }
      />
      {creating ? <ProductForm onDone={() => { setCreating(false); load() }} /> : null}
      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/product (Hanzo Commerce)" />
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={(r) => r.id}
          empty="No products yet. Create your first product to start your store's catalog."
        />
      )}
    </>
  )
}

// ── Orders ───────────────────────────────────────────────────────────────────
const orderColumns: Column<CommerceOrder>[] = [
  { key: 'number', header: 'Order', width: 160, render: (r) => <Strong>{r.number ?? r.id}</Strong> },
  { key: 'customer', header: 'Customer', render: (r) => (r.customer ? <Cell>{r.customer}</Cell> : <Dash />) },
  { key: 'total', header: 'Total', width: 120, render: (r) => <Cell>{fmtUsd(r.totalCents)}</Cell> },
  {
    key: 'status',
    header: 'Status',
    width: 140,
    render: (r) => (r.status ? <StatusTag status={humanizeStatus(r.status)} /> : <Dash />),
  },
  { key: 'created', header: 'Placed', width: 180, render: (r) => <Cell>{fmtAbs(r.createdAt)}</Cell> },
]

export function StoreOrdersModule(_props: { params: Record<string, string> }) {
  return (
    <CommerceResource<CommerceOrder>
      title="Orders"
      subtitle="Purchases placed in your store — status, customer, and total. Payments settle through Hanzo Commerce (Square)."
      load={() => CommerceApi.orders()}
      columns={orderColumns}
      rowKey={(r) => r.id}
      hint="endpoint · GET /v1/order (Hanzo Commerce)"
      empty="No orders yet. Orders customers place appear here as they come in."
    />
  )
}

// ── Customers ────────────────────────────────────────────────────────────────
const customerColumns: Column<CommerceCustomer>[] = [
  { key: 'name', header: 'Customer', render: (r) => (r.name ? <Strong>{r.name}</Strong> : <Dash />) },
  { key: 'email', header: 'Email', render: (r) => (r.email ? <Cell>{r.email}</Cell> : <Dash />) },
  { key: 'created', header: 'Joined', width: 180, render: (r) => <Cell>{fmtAbs(r.createdAt)}</Cell> },
]

export function StoreCustomersModule(_props: { params: Record<string, string> }) {
  return (
    <CommerceResource<CommerceCustomer>
      title="Customers"
      subtitle="People who have an account or have ordered from your store — scoped to your organization."
      load={() => CommerceApi.customers()}
      columns={customerColumns}
      rowKey={(r) => r.id}
      hint="endpoint · GET /v1/user (Hanzo Commerce)"
      empty="No customers yet. Customers who sign up or order appear here."
    />
  )
}

// ── Inventory (variants) ─────────────────────────────────────────────────────
const variantColumns: Column<CommerceVariant>[] = [
  { key: 'sku', header: 'SKU', width: 170, render: (r) => (r.sku ? <Strong>{r.sku}</Strong> : <Dash />) },
  { key: 'name', header: 'Variant', render: (r) => (r.name ? <Cell>{r.name}</Cell> : <Dash />) },
  { key: 'inventory', header: 'On hand', width: 110, render: (r) => <Cell>{fmtInt(r.inventory)}</Cell> },
  { key: 'price', header: 'Price', width: 110, render: (r) => <Cell>{fmtUsd(r.priceCents)}</Cell> },
]

export function StoreInventoryModule(_props: { params: Record<string, string> }) {
  return (
    <CommerceResource<CommerceVariant>
      title="Inventory"
      subtitle="Stock on hand per SKU (product variants). Track availability across your catalog."
      load={() => CommerceApi.variants()}
      columns={variantColumns}
      rowKey={(r) => r.id}
      hint="endpoint · GET /v1/variant (Hanzo Commerce)"
      empty="No inventory yet. Variants (SKUs) with stock counts appear here."
    />
  )
}

// ── Promotions & discounts ───────────────────────────────────────────────────
const discountColumns: Column<CommerceDiscount>[] = [
  { key: 'code', header: 'Code', width: 170, render: (r) => (r.code ? <Strong>{r.code}</Strong> : <Dash />) },
  { key: 'name', header: 'Name', render: (r) => (r.name ? <Cell>{r.name}</Cell> : <Dash />) },
  { key: 'value', header: 'Value', width: 120, render: (r) => <Cell>{discountValue(r.type, r.value)}</Cell> },
  {
    key: 'status',
    header: 'Status',
    width: 120,
    render: (r) => <StatusTag status={r.active ? 'active' : 'inactive'} />,
  },
  { key: 'created', header: 'Created', width: 180, render: (r) => <Cell>{fmtAbs(r.createdAt)}</Cell> },
]

export function StorePromotionsModule(_props: { params: Record<string, string> }) {
  return (
    <CommerceResource<CommerceDiscount>
      title="Promotions & discounts"
      subtitle="Discount codes and promotions customers can apply at checkout."
      load={() => CommerceApi.discounts()}
      columns={discountColumns}
      rowKey={(r) => r.id}
      hint="endpoint · GET /v1/discount (Hanzo Commerce)"
      empty="No promotions yet. Discount codes and promotions you create appear here."
    />
  )
}

// ── Store settings (real storefront config) ──────────────────────────────────
function openBilling(): void {
  if (typeof window !== 'undefined') window.open(config.billingUrl, '_blank', 'noopener')
}

export function StoreSettingsModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<Async<CommerceStore>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    CommerceApi.currentStore()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const store = state.phase === 'ready' ? state.data : null

  return (
    <>
      <PageHeader
        title="Store settings"
        subtitle="Your storefront configuration and how payments are processed."
        actions={<Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>}
      />
      <YStack gap="$3" maxW={720}>
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$5" fontWeight="700" color="$color12">Storefront</Text>
          {state.phase === 'error' ? (
            <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/store/current (Hanzo Commerce)" />
          ) : state.phase === 'loading' ? (
            <Text fontSize="$3" color="$color10">Loading your storefront…</Text>
          ) : (
            <XStack gap="$5" flexWrap="wrap" pt="$1">
              <SettingFact label="Store" value={store?.name || store?.slug || 'Default store'} />
              <SettingFact label="Currency" value={(store?.currency || 'usd').toUpperCase()} />
              {store?.slug ? <SettingFact label="Slug" value={store.slug} /> : null}
              {store?.createdAt ? <SettingFact label="Created" value={fmtAbs(store.createdAt)} /> : null}
            </XStack>
          )}
          <Text fontSize="$2" color="$color10" pt="$1">
            Your storefront configuration is scoped to your organization in Hanzo Commerce.
          </Text>
        </Card>

        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$5" fontWeight="700" color="$color12">Payments</Text>
          <Text fontSize="$3" color="$color11">
            Your store is powered by Hanzo Commerce. Orders and checkout settle through Square — the one payment
            processor for the platform. Balances, invoices, and payouts live in Billing.
          </Text>
          <XStack gap="$2" pt="$2">
            <Button size="$2" iconAfter={<ExternalLink size={14} />} onPress={openBilling}>Open Billing</Button>
          </XStack>
        </Card>
      </YStack>
    </>
  )
}

function SettingFact({ label, value }: { label: string; value: string }) {
  return (
    <YStack minW={120}>
      <Text fontSize="$2" color="$color10">{label}</Text>
      <Text fontSize="$4" fontWeight="700" color="$color12">{value}</Text>
    </YStack>
  )
}
