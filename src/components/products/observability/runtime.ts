/**
 * What a failed `/v1/o11y` read actually MEANS — the ONE place the console turns
 * an HTTP status into words, kept pure so every branch is testable against a real
 * status instead of an imagined one.
 *
 * The distinction that matters: 405 and 5xx mean the route WAS reached. The
 * runtime is up; either the console called it the wrong way, or the read failed
 * inside it. Neither is "the runtime isn't initialized", and saying so hides a
 * live backend behind a card announcing it is down — which is how a healthy
 * `/v1/o11y` sat behind an "initializing" notice while it was serving.
 *
 * Only a 503 says the store isn't ready, and only because the runtime said it.
 * Where the server states its own reason, that reason is what the reader sees;
 * the console never substitutes a guess for it.
 */
import { ApiError } from '~/lib/api/client'

export type RuntimeStatus =
  /** 503 — the route is mounted; the runtime refused because a dependency is not ready. */
  | 'not-initialized'
  /** 405 — the route exists and rejected the method the console used. A console defect. */
  | 'method'
  /** 5xx (not 503) — reached, and failed while serving the read. */
  | 'failed'
  /** 404 — nothing serves this path on this host. */
  | 'unavailable'
  /** 403 — signed in, but this org may not read the surface. */
  | 'access'
  /** 401 — the session lapsed. */
  | 'signin'
  /** No HTTP answer at all (network/abort), or a status none of the above claim. */
  | 'error'

/** The HTTP status a failed read carried, or 0 when it never reached one. */
const statusOf = (e: unknown): number => (e instanceof ApiError ? e.status : 0)

/** Map a failed o11y read to the one status that describes what actually happened. */
export function classifyRuntime(e: unknown): RuntimeStatus {
  const s = statusOf(e)
  if (s === 503) return 'not-initialized'
  if (s === 405) return 'method'
  if (s === 404) return 'unavailable'
  if (s === 401) return 'signin'
  if (s === 403) return 'access'
  if (s >= 500) return 'failed'
  return 'error'
}

export type RuntimeCopy = { status: RuntimeStatus; title: string; body: string }

/** The server's own words about the failure, empty when it offered none. */
const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? '')).trim()

/**
 * The honest title + body for a failed read of `/v1/o11y/<surface>`. Each branch
 * states what the backend did, and quotes its reason wherever it gave one.
 */
export function runtimeCopy(surface: string, e: unknown): RuntimeCopy {
  const status = classifyRuntime(e)
  const reason = reasonOf(e)
  const said = reason ? ` — ${reason}` : ''
  const route = `/v1/o11y/${surface}`
  switch (status) {
    case 'not-initialized':
      return {
        status,
        title: 'Runtime store not ready',
        body: `${route} is mounted, and the runtime refused this read${said}. Your ${surface} appear here as soon as its store is provisioned.`,
      }
    case 'method':
      return {
        status,
        title: 'Called with the wrong method',
        body: `${route} exists and rejected the method this page used (405). The runtime is up and serving — this is a defect in the console, not an outage.`,
      }
    case 'failed':
      return {
        status,
        title: 'The runtime returned an error',
        body: `${route} was reached and failed while serving the read${said}.`,
      }
    case 'unavailable':
      return {
        status,
        title: 'Not routed on this host',
        body: `Nothing serves ${route} on this host (404).`,
      }
    case 'access':
      return {
        status,
        title: 'Observability not enabled yet',
        body: `Observability isn't enabled for your organization yet, so your ${surface} can't be read${said}. It appears here automatically once it is.`,
      }
    case 'signin':
      return {
        status,
        title: 'Your session expired',
        body: `Your session has expired or isn't recognized here. Sign in again to view your ${surface}.`,
      }
    default:
      return {
        status,
        title: 'Could not reach observability',
        body: reason || `The read of ${route} failed before it reached a response.`,
      }
  }
}
