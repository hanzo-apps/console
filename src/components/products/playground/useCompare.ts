'use client'

/**
 * useCompare — orchestrates N model columns running ONE shared prompt in parallel.
 *
 * Each column gets its OWN AbortController and its OWN `runColumn`, so the calls
 * truly run concurrently (Promise.all over independent runners) and one column's
 * failure or stop never aborts the others. Column state updates independently as
 * each stream arrives. A single-model run is simply one column — same engine, no
 * special case. `run` resolves with each column's final result so the caller can
 * record History without re-reading React state.
 */
import { useCallback, useRef, useState } from 'react'

import { ApiError } from '~/lib/api'
import { classifyBackend } from '~/components/ui/BackendState'
import { runColumn } from './runner'
import { DEFAULT_SETTINGS, type Column, type RunMessage, type RunResult, type Settings } from './types'

let seq = 0
const nextId = (): string => `col_${Date.now().toString(36)}_${(seq++).toString(36)}`

/** A fresh idle column for `model`. */
export function makeColumn(model: string, settings: Settings | null = null): Column {
  return {
    id: nextId(),
    model,
    settings,
    phase: 'idle',
    content: '',
    usage: null,
    ttftMs: null,
    totalMs: null,
    error: null,
  }
}

/** Build the request params for a column from its effective settings. */
function paramsOf(s: Settings): { temperature: number; top_p: number; max_tokens?: number; stop?: string[] } {
  const max = Number(s.maxTokens)
  const stops = s.stop
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  return {
    temperature: s.temperature,
    top_p: s.topP,
    max_tokens: Number.isFinite(max) && max > 0 ? max : undefined,
    stop: stops.length ? stops : undefined,
  }
}

export type CompareRunResult = { model: string; result: RunResult }

export type Compare = {
  columns: Column[]
  shared: Settings
  sync: boolean
  running: boolean
  setSync: (v: boolean) => void
  setShared: (patch: Partial<Settings>) => void
  setColumnModel: (id: string, model: string) => void
  setColumnSettings: (id: string, patch: Partial<Settings>) => void
  resetColumnSettings: (id: string) => void
  addColumns: (models: string[]) => void
  removeColumn: (id: string) => void
  /** Effective settings for a column (shared when synced or no override). */
  effective: (col: Column) => Settings
  run: (messages: RunMessage[]) => Promise<CompareRunResult[]>
  cancel: () => void
}

export function useCompare(initialModels: string[], initialSettings: Settings = DEFAULT_SETTINGS): Compare {
  const [columns, setColumns] = useState<Column[]>(() => initialModels.map((m) => makeColumn(m)))
  const [shared, setSharedState] = useState<Settings>(initialSettings)
  const [sync, setSync] = useState(true)
  const [running, setRunning] = useState(false)

  // Refs so `run` reads the CURRENT columns/settings without being re-created.
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const sharedRef = useRef(shared)
  sharedRef.current = shared
  const syncRef = useRef(sync)
  syncRef.current = sync
  const controllers = useRef<Map<string, AbortController>>(new Map())

  const patchColumn = useCallback((id: string, patch: Partial<Column>) => {
    setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const effectiveOf = (col: Column): Settings =>
    syncRef.current || !col.settings ? sharedRef.current : col.settings

  const run = useCallback(async (messages: RunMessage[]): Promise<CompareRunResult[]> => {
    const snapshot = columnsRef.current
    if (snapshot.length === 0) return []

    // Mark every column streaming + clear its prior result.
    setColumns((cs) =>
      cs.map((c) => ({ ...c, phase: 'streaming', content: '', usage: null, ttftMs: null, totalMs: null, error: null })),
    )
    setRunning(true)
    controllers.current.clear()

    const out = await Promise.all(
      snapshot.map(async (col): Promise<CompareRunResult> => {
        const ctrl = new AbortController()
        controllers.current.set(col.id, ctrl)
        const s = effectiveOf(col)
        const result = await runColumn(
          { model: col.model, messages, ...paramsOf(s) },
          {
            onFirstToken: (ttftMs) => patchColumn(col.id, { ttftMs }),
            onDelta: (content) => patchColumn(col.id, { content }),
          },
          ctrl.signal,
        )
        patchColumn(col.id, {
          phase: result.error ? 'error' : 'done',
          content: result.content,
          usage: result.usage,
          ttftMs: result.ttftMs,
          totalMs: result.totalMs,
          error: result.error ? classifyBackend(new ApiError(result.error.message, result.error.status)) : null,
        })
        return { model: col.model, result }
      }),
    )

    setRunning(false)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchColumn])

  const cancel = useCallback(() => {
    for (const c of controllers.current.values()) c.abort()
  }, [])

  const setShared = useCallback((patch: Partial<Settings>) => setSharedState((s) => ({ ...s, ...patch })), [])
  const setColumnModel = useCallback((id: string, model: string) => patchColumn(id, { model }), [patchColumn])
  const setColumnSettings = useCallback(
    (id: string, patch: Partial<Settings>) =>
      setColumns((cs) =>
        cs.map((c) => (c.id === id ? { ...c, settings: { ...(c.settings ?? sharedRef.current), ...patch } } : c)),
      ),
    [],
  )
  const resetColumnSettings = useCallback((id: string) => patchColumn(id, { settings: null }), [patchColumn])
  const addColumns = useCallback(
    (models: string[]) => setColumns((cs) => [...cs, ...models.map((m) => makeColumn(m))]),
    [],
  )
  const removeColumn = useCallback((id: string) => {
    controllers.current.get(id)?.abort()
    controllers.current.delete(id)
    setColumns((cs) => (cs.length > 1 ? cs.filter((c) => c.id !== id) : cs))
  }, [])

  return {
    columns,
    shared,
    sync,
    running,
    setSync,
    setShared,
    setColumnModel,
    setColumnSettings,
    resetColumnSettings,
    addColumns,
    removeColumn,
    effective: effectiveOf,
    run,
    cancel,
  }
}
