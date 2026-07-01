'use client'

/**
 * The Commerce (Store) category pages — the merchant dashboard inside the console.
 * Each is a thin page over the shared `CommerceResource` list (one way to render a
 * store list) or, for Store settings, a small real settings view. Every row is real
 * commerce data for the SIGNED-IN ORG (the `/commerce` user-bearer proxy scopes it
 * server-side); an empty store shows honest empty copy — never a placeholder.
 *
 * Money stays in Billing (Square via `hanzoai/commerce` `/v1/billing`): these pages are
 * the catalog/order/customer surface only. One store, per org, IAM-SSO'd.
 */
import type { ReactNode } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { CommerceApi } from '~/lib/api/commerce'
import type {
  CommerceProduct,
  CommerceOrder,
  CommerceCustomer,
  CommerceVariant,
  CommerceDiscount,
} from '~/lib/api/commerce'
import { fmtUsd, fmtInt, fmtAbs } from '~/lib/api/functions'
import { type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { PageHeader } from '~/components/ui/PageHeader'
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

// ── Products ─────────────────────────────────────────────────────────────────
const productStatus = (p: CommerceProduct): string =>
  p.hidden ? 'hidden' : p.available ? 'available' : 'unavailable'

const productColumns: Column<CommerceProduct>[] = [
  { key: 'name', header: 'Product', render: (r) => <Strong>{r.name}</Strong> },
  { key: 'sku', header: 'SKU', width: 150, render: (r) => (r.sku ? <Cell>{r.sku}</Cell> : <Dash />) },
  { key: 'price', header: 'Price', width: 110, render: (r) => <Cell>{fmtUsd(r.priceCents)}</Cell> },
  { key: 'inventory', header: 'Stock', width: 90, render: (r) => <Cell>{fmtInt(r.inventory)}</Cell> },
  { key: 'status', header: 'Status', width: 130, render: (r) => <StatusTag status={productStatus(r)} /> },
  { key: 'created', header: 'Created', width: 180, render: (r) => <Cell>{fmtAbs(r.createdAt)}</Cell> },
]

export function StoreProductsModule(_props: { params: Record<string, string> }) {
  return (
    <CommerceResource<CommerceProduct>
      title="Products"
      subtitle="Your store's catalog — items customers can buy. Managed in Hanzo Commerce, scoped to your organization."
      load={() => CommerceApi.products()}
      columns={productColumns}
      rowKey={(r) => r.id}
      hint="endpoint · GET /v1/product (Hanzo Commerce)"
      empty="No products yet. Products you add to your store's catalog appear here."
    />
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

// ── Store settings ───────────────────────────────────────────────────────────
function openBilling(): void {
  if (typeof window !== 'undefined') window.open(config.billingUrl, '_blank', 'noopener')
}

export function StoreSettingsModule(_props: { params: Record<string, string> }) {
  return (
    <>
      <PageHeader title="Store settings" subtitle="Your storefront configuration and how payments are processed." />
      <YStack gap="$3" maxW={720}>
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$5" fontWeight="700" color="$color12">
            Payments
          </Text>
          <Text fontSize="$3" color="$color11">
            Your store is powered by Hanzo Commerce. Orders and checkout settle through Square — the one payment
            processor for the platform. Balances, invoices, and payouts live in Billing.
          </Text>
          <XStack gap="$2" pt="$2">
            <Button size="$2" iconAfter={<ExternalLink size={14} />} onPress={openBilling}>
              Open Billing
            </Button>
          </XStack>
        </Card>

        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$5" fontWeight="700" color="$color12">
            Catalog
          </Text>
          <Text fontSize="$3" color="$color11">
            Manage what you sell from the Commerce pages: Products (catalog), Inventory (stock per SKU), Orders
            (incoming purchases), Customers, and Promotions. Every page is scoped to your organization.
          </Text>
        </Card>
      </YStack>
    </>
  )
}
