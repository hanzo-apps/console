'use client'

/**
 * Scope context — the React layer over the module-level active scope (lib/scope.ts)
 * and the network registry (lib/network.ts).
 *
 * The non-React API client reads `getScope()` + `activeApiBase()` synchronously to
 * stamp headers and pick the cloud base; this provider keeps that module state in
 * sync with the user's selection and the persisted values. It owns the org's project
 * list (loaded once) AND the user's custom networks (localStorage), so the switcher
 * and the modules share one source of truth.
 *
 * Network + environment are ONE selection: the active network's `id` IS the active
 * `environment` string. Selecting a network re-scopes cloud calls (via `X-Environment`)
 * and retargets chain/RPC/API in a single move — no parallel state, no special-casing.
 *
 * Honest by construction: if the projects endpoint isn't routed on this deployment it
 * resolves to an empty list (org-level only) — never a fabricated project.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  DEFAULT_ENVIRONMENT,
  getScope,
  loadPersistedScope,
  persistScope,
  setScope,
  type Scope,
} from '~/lib/scope'
import {
  DEFAULT_NETWORK,
  STOCK_NETWORKS,
  loadCustomNetworks,
  networkById,
  persistCustomNetworks,
  setCustomRegistry,
  type Network,
} from '~/lib/network'
import { ApiError } from '~/lib/api'
import { ProjectApi, projectEnvironments, type Project } from '~/lib/api/projects'

type ScopeContextValue = {
  /** Active { project, environment } scope (org is owned by lib/org-scope.ts). */
  scope: Scope
  /** The org's projects (empty when the endpoint isn't routed — org-level only). */
  projects: Project[]
  /** Load failure (e.g. 404 not routed) — the switcher ignores it, the module surfaces it. */
  projectsError: ApiError | null
  /** The active project record, if a project is selected and known. */
  activeProject: Project | null
  /** Environments available for the active project: stock 3 + its custom ones. */
  environments: string[]
  /** Selectable networks: the stock set (mainnet/testnet/devnet/local) + user custom ones. */
  networks: Network[]
  /** The active network (chain identity + endpoints) — resolved from the environment string. */
  activeNetwork: Network
  /** True until the first project load settles. */
  loadingProjects: boolean
  /** Select a project (undefined = org-level). Resets env to the new scope's default. */
  selectProject: (name: string | undefined) => void
  /** Select an environment / network by id (stock, custom network, or project env). */
  selectEnvironment: (env: string) => void
  /** Add (or replace) a custom network and select it. */
  addCustomNetwork: (net: Network) => void
  /** Remove a custom network; falls back to mainnet if it was active. */
  removeCustomNetwork: (id: string) => void
  /** Re-fetch the project list (after create/delete). */
  refreshProjects: () => Promise<void>
}

const ScopeContext = createContext<ScopeContextValue | null>(null)

export function Scope({ children }: { children: ReactNode }) {
  // Mirror the module scope into React state so consumers re-render on change.
  const [scope, setScopeState] = useState<Scope>(() => getScope())
  const [customNetworks, setCustomNetworks] = useState<Network[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsError, setProjectsError] = useState<ApiError | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)

  const apply = useCallback((next: Partial<Scope>) => {
    const merged = setScope(next) // updates module state (read by the API client)
    persistScope(merged)
    setScopeState(merged)
  }, [])

  // Restore the persisted custom networks once, and mirror them into the module
  // registry so the non-React client resolves the active network synchronously.
  useEffect(() => {
    const loaded = loadCustomNetworks()
    setCustomRegistry(loaded)
    setCustomNetworks(loaded)
  }, [])

  // Restore the persisted { project, environment } once, before any module loads.
  useEffect(() => {
    const persisted = loadPersistedScope()
    if (persisted && (persisted.project || persisted.environment)) {
      apply({
        project: persisted.project,
        environment: persisted.environment ?? DEFAULT_ENVIRONMENT,
      })
    }
  }, [apply])

  const refreshProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      const list = await ProjectApi.list()
      const rows = Array.isArray(list) ? list : []
      setProjects(rows)
      setProjectsError(null)
      // Drop a stale project selection — e.g. after a global admin switches org,
      // the persisted project belongs to the previous org. Fall back to
      // org-level so we never scope to a project that isn't in the active org.
      const sel = getScope().project
      if (sel && !rows.some((p) => p.name === sel)) {
        apply({ project: undefined, environment: DEFAULT_ENVIRONMENT })
      }
    } catch (e) {
      // Endpoint not routed on this deployment → org-level only. The switcher
      // ignores this (empty list); the Projects module surfaces it honestly.
      setProjects([])
      setProjectsError(e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e)))
    } finally {
      setLoadingProjects(false)
    }
  }, [apply])

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  const activeProject = useMemo(
    () => projects.find((p) => p.name === scope.project) ?? null,
    [projects, scope.project],
  )

  const environments = useMemo(() => projectEnvironments(activeProject ?? undefined), [activeProject])

  const networks = useMemo(() => [...STOCK_NETWORKS, ...customNetworks], [customNetworks])

  const activeNetwork = useMemo(
    // customNetworks in the dep list so this recomputes after the registry updates.
    () => networkById(scope.environment) ?? DEFAULT_NETWORK,
    [scope.environment, customNetworks],
  )

  const selectProject = useCallback(
    (name: string | undefined) => {
      // Switching project resets the environment to mainnet — a custom env from
      // the previous project may not exist under the new one.
      apply({ project: name, environment: DEFAULT_ENVIRONMENT })
    },
    [apply],
  )

  const selectEnvironment = useCallback((env: string) => apply({ environment: env }), [apply])

  const addCustomNetwork = useCallback(
    (net: Network) => {
      setCustomNetworks((prev) => {
        const next = [...prev.filter((n) => n.id !== net.id), net]
        setCustomRegistry(next)
        persistCustomNetworks(next)
        return next
      })
      apply({ environment: net.id }) // select the just-added network
    },
    [apply],
  )

  const removeCustomNetwork = useCallback(
    (id: string) => {
      setCustomNetworks((prev) => {
        const next = prev.filter((n) => n.id !== id)
        setCustomRegistry(next)
        persistCustomNetworks(next)
        return next
      })
      if (getScope().environment === id) apply({ environment: DEFAULT_ENVIRONMENT })
    },
    [apply],
  )

  const value = useMemo<ScopeContextValue>(
    () => ({
      scope,
      projects,
      projectsError,
      activeProject,
      environments,
      networks,
      activeNetwork,
      loadingProjects,
      selectProject,
      selectEnvironment,
      addCustomNetwork,
      removeCustomNetwork,
      refreshProjects,
    }),
    [scope, projects, projectsError, activeProject, environments, networks, activeNetwork, loadingProjects, selectProject, selectEnvironment, addCustomNetwork, removeCustomNetwork, refreshProjects],
  )

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

/** Read the active scope + project list + network registry + selectors. Must be under <Scope>. */
export function useScope(): ScopeContextValue {
  const ctx = useContext(ScopeContext)
  if (!ctx) throw new Error('useScope must be used within <Scope>')
  return ctx
}
