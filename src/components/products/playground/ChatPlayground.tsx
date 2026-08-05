'use client'

/**
 * ChatPlayground — the single-model 3-zone surface for Chat and Completions:
 * the composer (left), Examples + History beneath it, and the Response + Model
 * settings rail (right). It owns the composer state, the live model catalog and
 * the run, and wires the header actions (Save / Code / Share) to the SAME state.
 *
 * Everything shown is real: models + context + pricing from the catalog, the
 * completion + token usage + cost from the gateway, History from prior local runs,
 * Examples as labelled starters. Honest states throughout — a catalog failure
 * still lets you type a model id and run; the response shows "—" when the gateway
 * returns no token counts, never a fabricated number.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { XStack, YStack } from '@hanzo/gui'

import { useSession } from '~/lib/auth/session'
import { useComposer } from './useComposer'
import { useModels, pricingOf, defaultModelId } from './useModels'
import { useChatRun } from './useChatRun'
import { Composer } from './Composer'
import { ResponsePanel } from './ResponsePanel'
import { ModelSettings } from './ModelSettings'
import { SettingsSheet } from './SettingsSheet'
import { ExamplesCard } from './ExamplesCard'
import { HistoryCard } from './HistoryCard'
import { HeaderActions } from './HeaderActions'
import { buildRunMessages, validateRun, type ComposerMsg } from './compose'
import { paramsOf } from './params'
import { buildRequestBody, toCurl, toJson } from './request-preview'
import { costOf } from './cost'
import { loadHistory, saveRun, clearHistory, type HistoryEntry } from './history'
import { loadSaved, removeSaved, type SavedPrompt } from './prompts'
import { decodeShare, SHARE_PARAM } from './share'
import type { Example } from './examples'
import { BackendStateCard } from '@hanzo/ui/product'

export function ChatPlayground({ mode }: { mode: 'chat' | 'completions' }) {
  const composer = useComposer()
  const models = useModels()
  const run = useChatRun()
  const { account } = useSession()
  // Per-user history key (org-qualified username), '' until the session resolves.
  const userKey = account ? `${account.owner}/${account.name}` : ''

  const [validation, setValidation] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [saved, setSaved] = useState<SavedPrompt[]>([])
  const [settingsOpen, setSettingsOpen] = useState(true) // desktop side-pane
  const [settingsSheet, setSettingsSheet] = useState(false) // mobile bottom sheet

  // Saved prompts load once; History (re)loads for the resolved user, so every
  // completed run auto-populates it and one account never sees another's runs.
  useEffect(() => {
    setSaved(loadSaved())
  }, [])
  useEffect(() => {
    setHistory(loadHistory(userKey))
  }, [userKey])

  // Once the catalog resolves, seed the model — restoring a `?p=` share link when
  // present, else picking a sensible Zen-first default. Runs once.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || models.phase === 'loading') return
    const token =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get(SHARE_PARAM) : null
    const shared = token ? decodeShare(token) : null
    if (shared) {
      composer.loadShare(shared)
      if (!shared.model && models.options.length) composer.setModel(defaultModelId(models.options))
      seeded.current = true
    } else if (models.options.length) {
      composer.setModel(defaultModelId(models.options))
      seeded.current = true
    }
    // else: catalog error with no share link — leave unseeded so a Retry still
    // seeds the promoted default once the catalog resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.phase])

  const turns: ComposerMsg[] = composer.messages.map((m) => ({ role: m.role, content: m.content }))

  // The REAL request body for the current composer (drives Code / Logs / caret).
  const requestBody = useMemo(
    () =>
      buildRequestBody(
        composer.model,
        buildRunMessages({
          mode,
          system: composer.system,
          messages: turns,
          vars: composer.vars,
          imageUrls: composer.attachments.map((a) => a.dataUrl),
        }),
        paramsOf(composer.settings),
      ),
    // turns is derived from composer.messages; depend on the underlying values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [composer.model, composer.system, composer.messages, composer.vars, composer.attachments, composer.settings, mode],
  )
  const curl = useMemo(() => toCurl(requestBody), [requestBody])
  const json = useMemo(() => toJson(requestBody), [requestBody])

  const pricing = pricingOf(models.byId.get(composer.model))

  const onRun = async () => {
    const err = validateRun({
      mode,
      model: composer.model,
      system: composer.system,
      messages: turns,
      vars: composer.vars,
      imageUrls: composer.attachments.map((a) => a.dataUrl),
    })
    if (err) {
      setValidation(err)
      return
    }
    setValidation(null)
    const messages = buildRunMessages({
      mode,
      system: composer.system,
      messages: turns,
      vars: composer.vars,
      imageUrls: composer.attachments.map((a) => a.dataUrl),
    })
    const result = await run.run({ model: composer.model, messages, ...paramsOf(composer.settings) })
    const cost = costOf(result.usage, pricing)
    setHistory(
      saveRun(userKey, {
        id: `run_${Date.now().toString(36)}`,
        at: Date.now(),
        mode,
        system: composer.system,
        user: turns.find((t) => t.role === 'user')?.content ?? '',
        columns: [
          {
            model: composer.model,
            ok: !result.error && !result.aborted,
            stopped: result.aborted,
            promptTokens: result.usage?.prompt_tokens ?? null,
            completionTokens: result.usage?.completion_tokens ?? null,
            totalUsd: cost.totalUsd,
            ttftMs: result.ttftMs,
            totalMs: result.totalMs,
          },
        ],
      }),
    )
  }

  // ⌘↵ / Ctrl+↵ runs — bound once, always calling the latest closure via a ref.
  const fire = useRef<() => void>(() => {})
  fire.current = () => {
    if (!run.running) void onRun()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        fire.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const applyExample = (e: Example) => {
    composer.loadConfig({ model: models.byId.has(e.model) ? e.model : composer.model, system: e.system, user: e.user })
    run.reset()
  }
  const applySaved = (s: SavedPrompt) => {
    composer.loadConfig({ model: models.byId.has(s.model) ? s.model : composer.model, system: s.system, user: s.user })
    run.reset()
  }
  const replay = (h: HistoryEntry) => {
    const model = h.columns[0]?.model
    composer.loadConfig({
      model: model && models.byId.has(model) ? model : composer.model,
      system: h.system,
      user: h.user,
    })
    run.reset()
  }

  return (
    <YStack gap="$3">
      {/* Action bar (Save / Code / Share) — operates on this composer */}
      <XStack justify="flex-end">
        <HeaderActions composer={composer} mode={mode} curl={curl} json={json} onSaved={setSaved} />
      </XStack>

      {/* The block reason now renders PROMINENTLY inside the Composer, right by Run
          (never a silent no-op) — no duplicate small line here. */}
      {models.phase === 'error' && models.error ? (
        <BackendStateCard
          state={models.error}
          onRetry={models.reload}
          hint="You can still type a model id and run — the context badge and cost need the catalog."
        />
      ) : null}

      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        {/* Builder — the composer with an attached, collapsible Model settings
            side-pane (a bottom sheet on mobile). The two outer columns each ask
            for a phone-safe min width, so they sit side-by-side on desktop and
            wrap into a clean vertical stack on a narrow screen (no h-scroll). */}
        <YStack flex={2} minW={320} gap="$3">
          <XStack gap="$3" items="flex-start" flexWrap="wrap">
            <YStack flex={1} minW={300}>
              <Composer
                composer={composer}
                mode={mode}
                models={models.entries}
                modelsLoading={models.phase === 'loading'}
                running={run.running}
                onRun={() => void onRun()}
                onStop={run.cancel}
                curl={curl}
                json={json}
                validation={validation}
                settingsOpen={settingsOpen}
                onToggleSettings={() => setSettingsOpen((s) => !s)}
                onOpenSettingsSheet={() => setSettingsSheet(true)}
              />
            </YStack>
            {/* Desktop settings side-pane — attached to the builder, collapsible.
                Hidden on mobile (base display:none); the bottom sheet takes over. */}
            {settingsOpen ? (
              <YStack display="none" $md={{ display: 'flex', width: 292 }}>
                <ModelSettings value={composer.settings} onChange={composer.setSettings} disabled={run.running} />
              </YStack>
            ) : null}
          </XStack>

          <XStack gap="$3" flexWrap="wrap" items="flex-start">
            <YStack flex={1} minW={240}>
              <ExamplesCard
                onApply={applyExample}
                saved={saved}
                onApplySaved={applySaved}
                onRemoveSaved={(id) => setSaved(removeSaved(id))}
              />
            </YStack>
            <YStack flex={1} minW={240}>
              <HistoryCard history={history} onReplay={replay} onClear={() => setHistory(clearHistory(userKey))} />
            </YStack>
          </XStack>
        </YStack>

        {/* Response — a 1/3 flex column at desktop; wraps below the builder on mobile. */}
        <YStack flex={1} minW={320} gap="$3">
          <ResponsePanel run={run} pricing={pricing} model={composer.model} requestJson={json} />
        </YStack>
      </XStack>

      {/* Mobile: the same Model settings as a dismissable bottom sheet. */}
      <SettingsSheet open={settingsSheet} onOpenChange={setSettingsSheet}>
        <ModelSettings value={composer.settings} onChange={composer.setSettings} disabled={run.running} chrome={false} />
      </SettingsSheet>
    </YStack>
  )
}
