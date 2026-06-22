/**
 * Product-module registry — the extensibility backbone of the console.
 *
 * "All cloud products" are admin modules. Each module declares its nav label,
 * icon, and routes once, here. The nav shell and router render from this list,
 * so adding a product = adding one `ProductModule` entry — no shell edits.
 *
 * A module is orthogonal: it owns its routes and components, knows nothing about
 * siblings. The registry only composes them.
 */
import type { ComponentType } from 'react'
import {
  Server,
  Route as RouteIcon,
  Boxes,
  Database,
  MessageSquare,
  CreditCard,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { ProvidersModule } from '~/components/products/ProvidersModule'
import { ModelsModule } from '~/components/products/ModelsModule'
import { ApplicationsModule } from '~/components/products/ApplicationsModule'
import { StoresModule } from '~/components/products/StoresModule'
import { ChatModule } from '~/components/products/ChatModule'

/** A Hanzo GUI icon component (e.g. `Server` from `@hanzogui/lucide-icons-2`). */
export type ProductIcon = typeof Server

/** One screen inside a product module. */
export type ProductRoute = {
  /** Path segment under the product, '' for the index. */
  path: string
  /** Rendered surface. Receives the matched route params. */
  component: ComponentType<{ params: Record<string, string> }>
}

/** A cloud product, surfaced as an admin module in the console. */
export type ProductModule = {
  /** Stable id and base path segment, e.g. 'providers'. */
  id: string
  /** Nav label. */
  label: string
  /** Nav icon. */
  icon: ProductIcon
  /** One-line description for the dashboard. */
  description: string
  /** Screens. The first route ('') is the module landing. */
  routes: ProductRoute[]
}

/**
 * The registered cloud products. Order here is nav order.
 *
 * To add a product: implement its module component(s) and append an entry.
 */
export const productModules: ProductModule[] = [
  {
    id: 'providers',
    label: 'Providers',
    icon: Server,
    description: 'Model, storage, and embedding providers.',
    routes: [
      { path: '', component: ProvidersModule },
      { path: ':name', component: ProvidersModule },
    ],
  },
  {
    id: 'models',
    label: 'Models',
    icon: RouteIcon,
    description: 'Model routes and routing policy.',
    routes: [
      { path: '', component: ModelsModule },
      { path: ':name', component: ModelsModule },
    ],
  },
  {
    id: 'applications',
    label: 'Applications',
    icon: Boxes,
    description: 'Deployed applications.',
    routes: [
      { path: '', component: ApplicationsModule },
      { path: ':name', component: ApplicationsModule },
    ],
  },
  {
    id: 'stores',
    label: 'Stores',
    icon: Database,
    description: 'Knowledge stores and vectors.',
    routes: [
      { path: '', component: StoresModule },
      { path: ':name', component: StoresModule },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: MessageSquare,
    description: 'Chat sessions and history.',
    routes: [
      { path: '', component: ChatModule },
      { path: ':name', component: ChatModule },
    ],
  },
]

/** Look up a module by id (base path segment). */
export const findModule = (id: string): ProductModule | undefined =>
  productModules.find((m) => m.id === id)

/** A nav item that opens an external Hanzo surface (not an in-console route). */
export type ExternalNavLink = {
  id: string
  label: string
  icon: ProductIcon
  href: string
}

/**
 * External products surfaced in the nav but owned by other services — opened in
 * a new tab, never reimplemented here. Billing is hanzoai/commerce (backend) +
 * hanzoai/billing (portal); the console links to it.
 */
export const externalLinks: ExternalNavLink[] = [
  { id: 'billing', label: 'Billing', icon: CreditCard, href: config.billingUrl },
]
