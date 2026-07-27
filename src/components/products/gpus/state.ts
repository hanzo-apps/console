/**
 * Shared async/state contract for the GPU tabs. The router module loads the real
 * sources ONCE and hands each tab the typed state; tabs are presentational and stay
 * orthogonal. Two honest error types by transport: `/paas` calls classify to
 * `PlatformError`, the `/v1` usage ledger to `BackendState`.
 */
import type { PlatformError } from '../platform/state'
import type { BackendState } from '@hanzo/ui/product'
import type { Cluster } from '~/lib/api'
import type { Usage } from '~/lib/api/billing'
import type { Gpu, GpuAlert, UsageLedger } from '~/lib/api/compute'

export type Async<T, E = PlatformError> =
  | { phase: 'loading' }
  | { phase: 'error'; error: E }
  | { phase: 'ready'; data: T }

/** Everything the GPU surface loads, shared across tabs (loaded once in the module). */
export type ComputeData = {
  /** Per-GPU inventory + telemetry (`GET /paas/gpus`). */
  gpus: Async<Gpu[]>
  /** The org's DOKS clusters — GPU clusters derived from the node size. */
  clusters: Async<Cluster[]>
  /** GPU alerts (`GET /paas/gpus/alerts`). */
  alerts: Async<GpuAlert[]>
  /** Metered usage over 7 days from the cloud usage ledger (`/v1/get-cloud-usages`). */
  ledger: Async<UsageLedger, BackendState>
  /** Real commerce usage total (`/billing/usage`) — the honest cost fallback today. */
  accountUsage: Async<Usage, BackendState>
  /** Refetch every source. */
  reload: () => void
}
