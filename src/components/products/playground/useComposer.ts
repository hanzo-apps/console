'use client'

/**
 * useComposer — the ONE source of composer truth (model, system prompt, the
 * ordered user/assistant turns, sampling settings, `{{variables}}` and an optional
 * image), shared by the header actions (Save / Code / Share) and the composer body
 * so they never drift. Setters are stable; a snapshot powers Share/Save and the
 * request preview. No network here — running is `useChatRun`'s job.
 */
import { useCallback, useMemo, useState } from 'react'

import { DEFAULT_SETTINGS, type Settings } from './types'
import { collectVars } from './variables'
import type { ComposerMsg } from './compose'
import type { ShareState } from './share'

/** An uploaded image attached to the next run (data URL kept in memory only). `id` is a
 *  stable key so the thumbnail strip survives adds/removes and each image is individually
 *  removable. */
export type Attachment = { id: string; name: string; dataUrl: string }
let attSeq = 1
const nextAttId = (): string => `att${attSeq++}`

/** A composer turn with a stable id (so React keys survive edits/reorders). */
export type ComposerMessage = ComposerMsg & { id: string }

// A pure, monotonic id — deterministic so the initial message id matches between
// the server render and client hydration (no `Date.now()` in the render path).
// New ids (id ≥ 1) are only minted in client event handlers, after hydration.
let seq = 1
const nextId = (): string => `m${seq++}`

export type Composer = {
  model: string
  system: string
  messages: ComposerMessage[]
  settings: Settings
  vars: Record<string, string>
  /** Images attached to the next run (multiple — a vision message can carry several). */
  attachments: Attachment[]
  /** Variable names referenced across system + messages (first-seen order). */
  varNames: string[]
  setModel: (m: string) => void
  setSystem: (s: string) => void
  addMessage: () => void
  updateMessage: (id: string, content: string) => void
  toggleRole: (id: string) => void
  removeMessage: (id: string) => void
  setSettings: (patch: Partial<Settings>) => void
  setVar: (k: string, v: string) => void
  /** APPEND images (a multi-select dialog OR successive uploads accumulate, never replace). */
  addAttachments: (list: { name: string; dataUrl: string }[]) => void
  removeAttachment: (id: string) => void
  loadConfig: (cfg: { model?: string; system: string; user: string }) => void
  loadShare: (s: ShareState) => void
  clear: () => void
  snapshot: (mode: 'chat' | 'completions') => ShareState
}

// The initial single message uses a FIXED id ('m0') so the server and client
// initial renders agree; `nextId()` (≥1) is only used for messages added later.
const freshMessages = (): ComposerMessage[] => [{ id: 'm0', role: 'user', content: '' }]

export function useComposer(): Composer {
  const [model, setModel] = useState('')
  const [system, setSystem] = useState('')
  const [messages, setMessages] = useState<ComposerMessage[]>(freshMessages)
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS)
  const [vars, setVars] = useState<Record<string, string>>({})
  const [attachments, setAttachments] = useState<Attachment[]>([])

  const setSettings = useCallback((patch: Partial<Settings>) => setSettingsState((s) => ({ ...s, ...patch })), [])
  const setVar = useCallback((k: string, v: string) => setVars((m) => ({ ...m, [k]: v })), [])
  const addAttachments = useCallback((list: { name: string; dataUrl: string }[]) => {
    if (!list.length) return
    setAttachments((prev) => [...prev, ...list.map((a) => ({ id: nextAttId(), name: a.name, dataUrl: a.dataUrl }))])
  }, [])
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const addMessage = useCallback(() => {
    setMessages((ms) => {
      const last = ms[ms.length - 1]
      const role: 'user' | 'assistant' = last && last.role === 'user' ? 'assistant' : 'user'
      return [...ms, { id: nextId(), role, content: '' }]
    })
  }, [])

  const updateMessage = useCallback((id: string, content: string) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, content } : m)))
  }, [])

  const toggleRole = useCallback((id: string) => {
    setMessages((ms) =>
      ms.map((m) => (m.id === id ? { ...m, role: m.role === 'user' ? 'assistant' : 'user' } : m)),
    )
  }, [])

  const removeMessage = useCallback((id: string) => {
    setMessages((ms) => (ms.length > 1 ? ms.filter((m) => m.id !== id) : ms))
  }, [])

  const loadConfig = useCallback((cfg: { model?: string; system: string; user: string }) => {
    if (cfg.model) setModel(cfg.model)
    setSystem(cfg.system)
    setMessages([{ id: nextId(), role: 'user', content: cfg.user }])
    setAttachments([])
  }, [])

  const loadShare = useCallback((s: ShareState) => {
    setModel(s.model)
    setSystem(s.system)
    setMessages(
      s.messages.length
        ? s.messages.map((m) => ({ id: nextId(), role: m.role, content: m.content }))
        : freshMessages(),
    )
    setSettingsState(s.settings)
    setAttachments([])
  }, [])

  const clear = useCallback(() => {
    setSystem('')
    setMessages(freshMessages())
    setVars({})
    setAttachments([])
  }, [])

  const varNames = useMemo(
    () => collectVars([system, ...messages.map((m) => m.content)]),
    [system, messages],
  )

  const snapshot = useCallback(
    (mode: 'chat' | 'completions'): ShareState => ({
      mode,
      model,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      settings,
    }),
    [model, system, messages, settings],
  )

  return {
    model,
    system,
    messages,
    settings,
    vars,
    attachments,
    varNames,
    setModel,
    setSystem,
    addMessage,
    updateMessage,
    toggleRole,
    removeMessage,
    setSettings,
    setVar,
    addAttachments,
    removeAttachment,
    loadConfig,
    loadShare,
    clear,
    snapshot,
  }
}
