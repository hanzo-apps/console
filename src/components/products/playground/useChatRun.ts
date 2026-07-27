'use client'

/**
 * useChatRun — single-model run state for the composer.
 *
 * Wraps the SAME `runColumn` binding the rest of the playground uses (one
 * streaming `/v1/chat/completions` through the keyless `/ai` proxy): it streams
 * the text into `content`, captures REAL token usage + time-to-first-token +
 * total, and classifies a failure into an honest `BackendState`. A new run aborts
 * any in-flight one; `cancel` stops it (partial text kept, marked `stopped`).
 */
import { useCallback, useRef, useState } from 'react'

import { ApiError, type ChatUsage } from '~/lib/api'
import { classifyBackend, type BackendState } from '@hanzo/ui/product'
import { runColumn, type RunInput } from './runner'
import type { RunPhase, RunResult } from './types'

export type ChatRunState = {
  phase: RunPhase
  content: string
  usage: ChatUsage | null
  ttftMs: number | null
  totalMs: number | null
  finishReason: string | null
  error: BackendState | null
}

const IDLE: ChatRunState = {
  phase: 'idle',
  content: '',
  usage: null,
  ttftMs: null,
  totalMs: null,
  finishReason: null,
  error: null,
}

export type ChatRun = ChatRunState & {
  running: boolean
  run: (input: RunInput) => Promise<RunResult>
  cancel: () => void
  reset: () => void
}

export function useChatRun(): ChatRun {
  const [st, setSt] = useState<ChatRunState>(IDLE)
  const ctrlRef = useRef<AbortController | null>(null)

  const run = useCallback(async (input: RunInput): Promise<RunResult> => {
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setSt({ ...IDLE, phase: 'streaming' })

    const result = await runColumn(
      input,
      {
        onFirstToken: (ttftMs) => setSt((s) => ({ ...s, ttftMs })),
        onDelta: (content) => setSt((s) => ({ ...s, content })),
      },
      ctrl.signal,
    )

    setSt({
      phase: result.error ? 'error' : result.aborted ? 'stopped' : 'done',
      content: result.content,
      usage: result.usage,
      ttftMs: result.ttftMs,
      totalMs: result.totalMs,
      finishReason: result.finishReason,
      error: result.error ? classifyBackend(new ApiError(result.error.message, result.error.status)) : null,
    })
    return result
  }, [])

  const cancel = useCallback(() => ctrlRef.current?.abort(), [])
  const reset = useCallback(() => {
    ctrlRef.current?.abort()
    setSt(IDLE)
  }, [])

  return { ...st, running: st.phase === 'streaming', run, cancel, reset }
}
