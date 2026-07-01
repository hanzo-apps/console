'use client'

/**
 * LivingOverviewModule — the registry-facing wrapper. A product's overview route
 * renders `livingOverviewModule('<id>')`, which resolves the declared config and
 * hands it to the reusable `LivingOverview`. This is the ONE glue between the
 * product registry and the living-overview system: the registry names an id, this
 * looks up its config, `LivingOverview` renders + animates it.
 *
 * The same component is the all-orgs admin god-view — it forwards `allOrgs` to the
 * config's loader (which forwards `?org=all`), exactly like the prior OverviewModule.
 */
import { livingOverviewFor } from './registry'
import { LivingOverview } from './LivingOverview'
import type { LivingOverviewComponent } from './config'

/** Build the module component for a product id (bound at registry-declaration time). */
export function livingOverviewModule(id: string): LivingOverviewComponent {
  function Module({ allOrgs }: { params: Record<string, string>; allOrgs?: boolean }) {
    const config = livingOverviewFor(id)
    // A registry wiring bug (id with no config) is caught at build via the tests;
    // at runtime we fail honestly rather than render a blank screen.
    if (!config) return null
    return <LivingOverview config={config} allOrgs={allOrgs} />
  }
  Module.displayName = `LivingOverview(${id})`
  return Module
}
