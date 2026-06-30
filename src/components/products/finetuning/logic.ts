/**
 * Pure helpers for the Fine-tuning surface — formatting, HuggingFace metadata
 * interpretation, and the saved-config store's merge logic. Kept pure (no React,
 * no GUI) so the display/derivation rules are a tested value, not inline JSX
 * detail. The cost/time numbers themselves come from the backend recommendation
 * (one source of truth with the GPU-hours meter); this only FORMATS them.
 */
import type {
  CreateFinetuneInput,
  FinetuneJob,
  HfModel,
} from '~/lib/api/finetune'

/** Cents → "$1.23". Defensive against undefined/negative. */
export function formatCents(cents?: number): string {
  const c = typeof cents === 'number' && cents > 0 ? cents : 0
  return `$${(c / 100).toFixed(2)}`
}

/** Minutes → "12 min" or "1h 05m". */
export function formatDurationMin(minutes?: number): string {
  const m = typeof minutes === 'number' && minutes > 0 ? Math.round(minutes) : 0
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return `${h}h ${String(rem).padStart(2, '0')}m`
}

/**
 * Client-side cost estimate for a live GPU override, in cents — mirrors the
 * backend's gpuSecondsCostCents (object/finetune_billing.go): cents = hours ×
 * units × rate, rounded up. The backend recommendation is still authoritative for
 * the default; this only re-quotes when the operator changes the GPU/count so the
 * shown price tracks the selection.
 */
export function estimateCostCents(
  minutes: number,
  hourlyCents: number,
  gpuCount: number,
  numNodes = 1,
): number {
  const units = Math.max(1, gpuCount) * Math.max(1, numNodes)
  const cents = Math.ceil((Math.max(0, minutes) / 60) * units * Math.max(0, hourlyCents))
  return cents
}

/** Compact count: 1234 → "1.2k", 3_400_000 → "3.4M". */
export function humanCount(n?: number): string {
  const v = typeof n === 'number' && n > 0 ? n : 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(v)
}

/** HuggingFace `gated` is `false` or a string ("auto"/"manual"); normalize to bool. */
export function isGated(gated?: boolean | string): boolean {
  if (typeof gated === 'boolean') return gated
  if (typeof gated === 'string') return gated !== '' && gated !== 'false'
  return false
}

/** A model that needs a token to pull (private or gated). */
export function needsToken(m: Pick<HfModel, 'private' | 'gated'>): boolean {
  return Boolean(m.private) || isGated(m.gated)
}

/** Human method label. */
export function methodLabel(method?: string): string {
  switch (method) {
    case 'qlora':
      return 'QLoRA (4-bit)'
    case 'lora':
      return 'LoRA'
    case 'full':
      return 'Full fine-tune'
    default:
      return method || '—'
  }
}

/** Best display title for a job. */
export function jobTitle(job: Pick<FinetuneJob, 'displayName' | 'baseModel' | 'name'>): string {
  return job.displayName || job.baseModel || job.name
}

/** Whether a job is still doing work (drives polling + the spinner). */
export function isActive(status?: string): boolean {
  return status === 'pending' || status === 'queued' || status === 'running'
}

/** Whether a job finished successfully (drives the Deploy action). */
export function isDeployable(job: Pick<FinetuneJob, 'status'>): boolean {
  return job.status === 'succeeded'
}

/** Progress 0..100 for the bar — succeeded clamps to 100. */
export function progressOf(job: Pick<FinetuneJob, 'status' | 'progress'>): number {
  if (job.status === 'succeeded') return 100
  const p = typeof job.progress === 'number' ? job.progress : 0
  return Math.max(0, Math.min(100, p))
}

// ── Saved configs (Save-as-config) ──────────────────────────────────────────
// A "config" is a reusable new-job template. The merge logic is pure + tested;
// persistence is a thin localStorage wrapper around it.

export type SavedConfig = { name: string; input: CreateFinetuneInput; savedAt: string }

const CONFIGS_KEY = 'hanzo.finetune.configs'

/** Upsert a config by name into a list (newest first), returning a NEW list. */
export function upsertConfig(list: SavedConfig[], cfg: SavedConfig): SavedConfig[] {
  const rest = list.filter((c) => c.name !== cfg.name)
  return [cfg, ...rest]
}

/** Remove a config by name, returning a NEW list. */
export function removeConfig(list: SavedConfig[], name: string): SavedConfig[] {
  return list.filter((c) => c.name !== name)
}

/** Load saved configs from localStorage (SSR-safe → []). */
export function loadConfigs(): SavedConfig[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CONFIGS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedConfig[]) : []
  } catch {
    return []
  }
}

/** Persist saved configs to localStorage (SSR-safe no-op). */
export function saveConfigs(list: SavedConfig[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CONFIGS_KEY, JSON.stringify(list))
  } catch {
    /* quota / disabled storage — non-fatal, configs are a convenience */
  }
}
