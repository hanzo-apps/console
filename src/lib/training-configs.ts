/**
 * Saved training configs — the user's own reusable New-job presets, stored
 * CLIENT-SIDE in localStorage (honest: these are your saved inputs, not a backend
 * resource). Keyed per active org so switching orgs shows the right set. Pure
 * read/write helpers + a tiny event so the Configs tab refreshes when one is saved.
 */
export type TrainingConfig = {
  id: string
  name: string
  baseModel: string
  type: string
  dataset: string
  learningRate: number
  batchSize: number
  epochs: number
  preset: string
  gpu: string
  gpuCount: number
  createdAt: string
}

const KEY = (org: string) => `hanzo.training.configs.${org || 'default'}`
const EVENT = 'hanzo:training-configs'

/** Read saved configs for an org (newest first). Never throws. */
export function loadConfigs(org: string): TrainingConfig[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY(org))
    const arr = raw ? (JSON.parse(raw) as TrainingConfig[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** Persist a new config (prepended). Returns the updated list. */
export function saveConfig(org: string, cfg: Omit<TrainingConfig, 'id' | 'createdAt'>): TrainingConfig[] {
  const entry: TrainingConfig = {
    ...cfg,
    id: `cfg-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
  }
  const next = [entry, ...loadConfigs(org)].slice(0, 50)
  try {
    window.localStorage.setItem(KEY(org), JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(EVENT))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
  return next
}

/** Remove a saved config by id. Returns the updated list. */
export function removeConfig(org: string, id: string): TrainingConfig[] {
  const next = loadConfigs(org).filter((c) => c.id !== id)
  try {
    window.localStorage.setItem(KEY(org), JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(EVENT))
  } catch {
    /* non-fatal */
  }
  return next
}

/** Subscribe to config changes (Configs tab live refresh). Returns an unsubscribe. */
export function onConfigsChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
