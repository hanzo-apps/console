/**
 * PaaS control-plane client (Job 3). Talks to console2's OWN origin under
 * `/paas/*`, which the server-side proxy forwards to platform.hanzo.ai/v1 with
 * the service token attached. So the browser never sees the token, and there is
 * no CORS. Everything here is REAL platform data — no mocks.
 */

/** One deployed app as the platform control plane reports it. Fields are
 * optional because the upstream shape evolves; the UI renders what is present
 * and never fabricates the rest. */
export type PaasApp = {
  id?: string
  name?: string
  service?: string
  cluster?: string
  namespace?: string
  status?: string
  health?: string
  declaredTag?: string
  runningTag?: string
  latestTag?: string
  declared?: string
  running?: string
  latest?: string
  drift?: boolean
  image?: string
  updatedAt?: string
}

export class PaasError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'PaasError'
  }
}

async function paasRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/paas/${path.replace(/^\/+/, '')}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text
    } catch {
      /* keep raw text */
    }
    throw new PaasError(res.status, msg || res.statusText)
  }
  return text ? (JSON.parse(text) as T) : ({} as T)
}

/** Normalize the apps payload (array, or `{ apps: [...] }`, or `{ data: [...] }`). */
function asApps(raw: unknown): PaasApp[] {
  if (Array.isArray(raw)) return raw as PaasApp[]
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.apps)) return o.apps as PaasApp[]
    if (Array.isArray(o.data)) return o.data as PaasApp[]
    if (Array.isArray(o.items)) return o.items as PaasApp[]
  }
  return []
}

export const paas = {
  /** List every app/deploy the control plane manages, across clusters. */
  async listApps(): Promise<PaasApp[]> {
    return asApps(await paasRequest<unknown>('GET', 'apps'))
  },
  /** Trigger a health-gated rolling redeploy of one app (real action). */
  async redeploy(id: string): Promise<unknown> {
    return paasRequest<unknown>('POST', `apps/${encodeURIComponent(id)}/redeploy`)
  },
}

/** Read an app's declared vs running tag with drift, defensively. */
export function appTags(a: PaasApp): { declared: string; running: string; latest: string; drift: boolean } {
  const declared = a.declaredTag ?? a.declared ?? '—'
  const running = a.runningTag ?? a.running ?? '—'
  const latest = a.latestTag ?? a.latest ?? '—'
  const drift = a.drift ?? (declared !== '—' && running !== '—' && declared !== running)
  return { declared, running, latest, drift }
}
