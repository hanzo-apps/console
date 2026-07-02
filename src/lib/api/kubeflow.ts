/**
 * KubeflowApi — the Kubeflow control-plane lens over the cloud mlsvc bridge
 * (hanzoai/cloud `clients/ml`), reached through the console's OWN `/training`
 * proxy (session cookie + active org, server-side).
 *
 * The mlsvc turns Kubeflow-family CustomResources into REST, so these ARE the
 * live Kubeflow objects, not a reimplementation:
 *   - Katib Experiments (`kubeflow.org/v1beta1`)  → the orchestrated ML pipelines
 *     (`GET /v1/train/experiments`, delegated to `TrainApi.experiments`).
 *   - trainer TrainJobs (`trainer.kubeflow.org/v1alpha1`) → the pipeline runs
 *     (`GET /v1/train/jobs`, delegated to `TrainApi.listJobs`).
 *
 * Pipelines/runs therefore REUSE `TrainApi` (ONE fetch + normalize layer — no
 * duplication). This module adds only the one thing the console lacked: the
 * control-plane HEALTH probe (`GET /v1/train/health`), a REAL check of whether
 * the Kubeflow operators are reachable and which CRDs are actually served.
 *
 * The probe returns 200 `{status:"ok"}` when healthy and 503 WITH a body when
 * degraded (k8s unreachable or a CRD missing). We deliberately do NOT route it
 * through `client.ts` `restGet` — that throws on any non-2xx, discarding the
 * degraded body we want to render honestly. So `controlPlane` does a tolerant
 * direct fetch (cookie credentials, same origin proxy) and never throws: an
 * unreachable/denied/degraded plane resolves to `healthy:false` with the real
 * reason, which the module surfaces as an honest "not reporting" state.
 */

const trainingBase = (): string =>
  typeof window !== 'undefined' ? `${window.location.origin}/training` : '/training'

/** Live state of the Kubeflow training control plane (real `/train/health` probe). */
export type KubeflowControlPlane = {
  /** True ONLY on a 200 `{status:"ok"}` — k8s reachable AND every CRD served. */
  healthy: boolean
  /** The cluster's Kubernetes API is reachable from cloud-api. */
  k8s: boolean
  /** Which Kubeflow CRDs are served, by k8s resource name (`trainjobs`, `experiments`). */
  crds: Record<string, boolean>
  /** Honest failure reason when not healthy (probe error or HTTP status). */
  error?: string
}

const asBoolMap = (v: unknown): Record<string, boolean> => {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, boolean> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = Boolean(val)
  return out
}

export const KubeflowApi = {
  /**
   * Probe the Kubeflow control plane. Resolves ALWAYS (never throws) so the strip
   * can render a degraded/not-reporting state from the real body or status.
   */
  controlPlane: async (): Promise<KubeflowControlPlane> => {
    let res: Response
    try {
      res = await fetch(`${trainingBase()}/train/health`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
    } catch (e) {
      return { healthy: false, k8s: false, crds: {}, error: e instanceof Error ? e.message : 'unreachable' }
    }

    let body: Record<string, unknown> = {}
    try {
      const parsed = (await res.json()) as unknown
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
    } catch {
      /* non-JSON (e.g. a proxy 502 text) — treat as unreachable below */
    }

    const status = typeof body.status === 'string' ? body.status : undefined
    const error = typeof body.error === 'string' ? body.error : undefined
    return {
      healthy: res.ok && status === 'ok',
      k8s: Boolean(body.k8s),
      crds: asBoolMap(body.crds),
      error: res.ok ? error : error ?? `HTTP ${res.status}`,
    }
  },
}

/** The Kubeflow operators the training control plane orchestrates, mapped to the
 *  CRD (k8s resource) name `/train/health` reports as served. One place so the
 *  strip and any future surface read the same operator axis. */
export const KUBEFLOW_OPERATORS = [
  { label: 'Trainer', crd: 'trainjobs', role: 'Pipeline runs' },
  { label: 'Katib', crd: 'experiments', role: 'Pipelines' },
] as const
