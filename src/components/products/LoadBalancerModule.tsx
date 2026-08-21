'use client'

/**
 * Load Balancers — L4/L7 traffic distribution across backend targets.
 *
 * Cloud routes no balancer resource (HIP-0139). Spreading traffic across the
 * replicas of a deployed app is what the platform ingress does on its own, so
 * there is nothing here to list or create, and the page says that rather than
 * offering a form whose POST lands nowhere.
 */
import { EmptyState, PageHeader } from '@hanzo/ui/product'
import { Spline } from '@hanzogui/lucide-icons-2'

export function LoadBalancerModule(_props: { params: Record<string, string> }) {
  return (
    <>
      <PageHeader
        title="Load Balancers"
        subtitle="Spread incoming traffic across your services — at the connection level or the request level."
      />

      <EmptyState
        icon={Spline}
        title="Balancing is already on"
        description="Every app you deploy is fronted by the platform ingress, which health-checks its replicas and spreads requests across the healthy ones. Scale an app to add targets; there is no separate balancer to create."
      />
    </>
  )
}
