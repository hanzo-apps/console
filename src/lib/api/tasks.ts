/**
 * Tasks API — the durable workflow engine (hanzoai/tasks), unified into the
 * console. Plain REST over `/v1/tasks` (restGet): the engine returns raw JSON
 * (200) or `{ error, code }`. Multi-tenant — every call is scoped to the
 * caller's org server-side (the gateway injects identity from the session and
 * strips client-supplied identity headers), so the browser sends cookie
 * credentials only. Honest states render when a route is gated/absent.
 *
 * Contract verified against hanzoai/tasks `pkg/tasks/embed.go` (the HTTP shim
 * that mirrors the ZAP engine so the two transports can't drift): namespaces
 * group an org's work; one workflow execution is one durable "task".
 */
import { restGet, v1Url } from './client'

/** Cluster liveness — `{ status: "ok" | "down" }`. */
export type ClusterHealth = { status: string }

/** Cluster status — engine topology + replication counters. */
export type ClusterStatus = {
  nodeId?: string
  replicator?: string
  shardCount?: number
  openShards?: number
  validators?: string[]
  stats?: { accepted?: number; rejected?: number; timeouts?: number }
}

export type NamespaceInfo = {
  name: string
  state?: string
  description?: string
  ownerEmail?: string
  region?: string
  createTime?: string
}

/** A namespace — the per-org workflow tenant. */
export type Namespace = {
  namespaceInfo: NamespaceInfo
  config?: { workflowExecutionRetentionTtl?: string; apsLimit?: number }
  isActive?: boolean
}

/** A workflow execution — one durable "task". */
export type WorkflowExecution = {
  execution: { workflowId: string; runId: string }
  type: { name: string }
  status: string
  startTime?: string
  closeTime?: string
  taskQueue?: string
  historyLength?: number
}

/** Workflow detail — execution info plus its run config. */
export type WorkflowDetail = {
  workflowExecutionInfo: WorkflowExecution
  executionConfig?: { taskQueue?: { name: string } }
}

/** One event in a workflow's durable history. */
export type HistoryEvent = {
  eventId?: number
  eventTime?: string
  eventType?: string
  [k: string]: unknown
}

/** A schedule — a recurring (cron/interval) task. */
export type Schedule = {
  scheduleId: string
  namespace?: string
  state?: { paused?: boolean; note?: string }
  info?: { actionCount?: number; nextActionTime?: string; createTime?: string; updateTime?: string }
  action?: { workflowType?: { name?: string }; taskQueue?: string }
}

const u = (path: string): string => v1Url(`tasks/${path.replace(/^\/+/, '')}`)
const enc = encodeURIComponent

export const TasksApi = {
  /** Cluster liveness (unauthenticated probe). */
  health: (): Promise<ClusterHealth> => restGet<ClusterHealth>(u('cluster/health')),

  /** Cluster status — engine + replication counters. */
  cluster: (): Promise<ClusterStatus> => restGet<ClusterStatus>(u('cluster')),

  /** The caller-org's namespaces (honest empty when none registered). */
  namespaces: async (): Promise<Namespace[]> => {
    const r = await restGet<{ namespaces?: Namespace[] }>(u('namespaces'))
    return r?.namespaces ?? []
  },

  /** Workflow executions in a namespace — optionally a visibility query. */
  workflows: async (ns: string, query?: string): Promise<WorkflowExecution[]> => {
    const q = query ? `?query=${enc(query)}` : ''
    const r = await restGet<{ executions?: WorkflowExecution[] }>(u(`namespaces/${enc(ns)}/workflows${q}`))
    return r?.executions ?? []
  },

  /** One workflow's detail (latest run unless `runId` is given). */
  workflow: (ns: string, workflowId: string, runId?: string): Promise<WorkflowDetail> => {
    const q = runId ? `?runId=${enc(runId)}` : ''
    return restGet<WorkflowDetail>(u(`namespaces/${enc(ns)}/workflows/${enc(workflowId)}${q}`))
  },

  /** A workflow's durable history events (newest page first when reversed). */
  history: async (ns: string, workflowId: string, runId?: string): Promise<HistoryEvent[]> => {
    const p = new URLSearchParams({ pageSize: '50' })
    if (runId) p.set('runId', runId)
    const r = await restGet<{ events?: HistoryEvent[] }>(
      u(`namespaces/${enc(ns)}/workflows/${enc(workflowId)}/history?${p.toString()}`),
    )
    return r?.events ?? []
  },

  /** Schedules (recurring tasks) in a namespace. */
  schedules: async (ns: string): Promise<Schedule[]> => {
    const r = await restGet<{ schedules?: Schedule[] }>(u(`namespaces/${enc(ns)}/schedules`))
    return r?.schedules ?? []
  },
}
