'use client'

/**
 * AgentBuilder — the CANONICAL, shareable Hanzo agent builder.
 *
 * ONE builder, one and only one way to define an agent (name · model · prompt ·
 * tools · description), used by every surface. It is self-contained and injected:
 * the host passes `AgentBuilderLoaders` (the live model catalog, the saved-prompt
 * library, a prompt-body fetch, and the create effect) — the builder owns the form,
 * the LIVE dropdowns, validation, and the honest states, but knows NOTHING about
 * any host's API client. That is what lets console2, chat, app, bot, and team all
 * import this exact component over the SAME backend (`POST /cloud/v1/agents`, org
 * resolved server-side from the caller's bearer) instead of each rebuilding a form.
 *
 * Dynamic by construction:
 *   - Model  → a ComboBox: type any id OR pick from the LIVE `/v1/models` catalog.
 *   - Prompt → a selector of the org's saved prompts (fills the system prompt), with
 *              a "Custom" option for free text — "the system prompt is selectable
 *              from saved prompts OR typed".
 *   - Tools  → a ComboBox with the live tool catalog, added as chips (typeable too).
 * Every option set is REAL (from a loader) or the field degrades to typeable — never
 * a fabricated model/prompt/tool.
 *
 * Deps: only `@hanzo/gui`, the shared `ComboBox`/`Field` UI primitives, and this
 * module's own `./types`/`./logic`. No `~/lib/api` — so it lifts cleanly into
 * `@hanzo/agent-builder`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Bot, Plus, Terminal, X } from '@hanzogui/lucide-icons-2'

import { ComboBox, type ComboOption } from '~/components/ui/ComboBox'
import { FieldRow, FieldText, FieldTextArea } from '~/components/ui/Field'
import { SelectMenu, type SelectOption } from '~/components/ui/SelectMenu'
import {
  canSubmit,
  classifyBuilderError,
  defaultModel,
  emptySpec,
  promptBodyFromRow,
  promptOptions,
  toCreateBody,
} from './logic'
import type { AgentBuilderLoaders, AgentSpec, BuilderOption, BuilderPrompt } from './types'

/** Async option-list state for the live pickers (model/tool). */
type OptState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; options: BuilderOption[] }

const CUSTOM = '__custom__'

export function AgentBuilder({
  loaders,
  onCreated,
  onCancel,
  submitLabel = 'Create agent',
}: {
  loaders: AgentBuilderLoaders
  /** Called after a successful create (the host reloads its list + closes the form). */
  onCreated: () => void
  /** Called when the user cancels (optional — omit for an always-open form). */
  onCancel?: () => void
  submitLabel?: string
}) {
  const [spec, setSpec] = useState<AgentSpec>(emptySpec)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  const [models, setModels] = useState<OptState>({ phase: 'idle' })
  const [tools, setTools] = useState<OptState>({ phase: 'idle' })
  const [prompts, setPrompts] = useState<BuilderPrompt[] | null>(null)
  const [promptPick, setPromptPick] = useState<string | null>(null)

  const set = <K extends keyof AgentSpec>(k: K, v: AgentSpec[K]) => setSpec((s) => ({ ...s, [k]: v }))

  // Preselect a Zen default ONLY if the user hasn't typed a model yet — refs so the
  // loader doesn't re-run on every keystroke.
  const specRef = useRef(spec)
  specRef.current = spec

  const loadModels = useCallback(() => {
    if (!loaders.loadModels) return
    setModels({ phase: 'loading' })
    loaders
      .loadModels()
      .then((options) => {
        setModels({ phase: 'ready', options })
        if (!specRef.current.model) {
          const d = defaultModel(options)
          if (d) set('model', d)
        }
      })
      .catch((e) => setModels({ phase: 'error', message: msg(e) }))
  }, [loaders])

  const loadTools = useCallback(() => {
    if (!loaders.loadTools) return
    setTools({ phase: 'loading' })
    loaders
      .loadTools()
      .then((options) => setTools({ phase: 'ready', options }))
      .catch((e) => setTools({ phase: 'error', message: msg(e) }))
  }, [loaders])

  useEffect(() => {
    loadModels()
    loadTools()
    if (loaders.loadPrompts) {
      loaders
        .loadPrompts()
        .then((rows) => setPrompts(rows))
        .catch(() => setPrompts([])) // prompts optional — hide the selector on failure
    } else {
      setPrompts([])
    }
  }, [loadModels, loadTools, loaders])

  // ── Prompt selector: pick a saved prompt → fill systemPrompt (Custom = free) ──
  const onPickPrompt = async (name: string | null) => {
    setPromptPick(name)
    if (!name || name === CUSTOM) return // Custom → leave the textarea as the user's own
    const inline = promptBodyFromRow(prompts ?? [], name)
    if (inline != null) {
      set('systemPrompt', inline)
      return
    }
    if (loaders.loadPromptBody) {
      try {
        const body = await loaders.loadPromptBody(name)
        set('systemPrompt', body)
      } catch {
        // couldn't fetch the body — keep whatever's typed; the pick still records intent
      }
    }
  }

  // ── Tools as chips ────────────────────────────────────────────────────────
  const [toolDraft, setToolDraft] = useState('')
  const addTool = (v: string) => {
    const t = v.trim()
    if (t && !spec.tools.includes(t)) set('tools', [...spec.tools, t])
    setToolDraft('')
  }
  const removeTool = (t: string) => set('tools', spec.tools.filter((x) => x !== t))

  const submit = async () => {
    if (!canSubmit(spec) || busy) return
    setBusy(true)
    setError(null)
    setUnavailable(false)
    try {
      await loaders.createAgent(toCreateBody(spec) as AgentSpec)
      onCreated()
    } catch (e) {
      const c = classifyBuilderError(e)
      if (c.kind === 'unavailable') setUnavailable(true)
      else setError(c.message)
    } finally {
      setBusy(false)
    }
  }

  const modelOptions: ComboOption[] = models.phase === 'ready' ? models.options : []
  const toolOptions: ComboOption[] = tools.phase === 'ready' ? tools.options : []
  const promptSelectOptions: SelectOption<string>[] = [
    { key: CUSTOM, label: 'Custom (type your own)' },
    ...promptOptions(prompts ?? []).map((o) => ({ key: o.value, label: o.label ?? o.value })),
  ]

  return (
    <YStack gap="$3">
      <Text fontSize="$2" color="$color11">
        An agent is a model, a system prompt, and a set of tools that runs on Hanzo compute and calls your APIs on
        its own.
      </Text>

      <FieldRow label="Name">
        <FieldText value={spec.name} onChange={(v) => set('name', v)} placeholder="support-triage" />
      </FieldRow>

      <FieldRow label="Model">
        <ComboBox
          value={spec.model}
          onChange={(v) => set('model', v)}
          options={modelOptions}
          loading={models.phase === 'loading'}
          error={models.phase === 'error' ? `Model catalog unavailable — type a model id. (${models.message})` : null}
          onRetry={loadModels}
          placeholder="zen-omni · gpt-4o-mini · claude-sonnet-4-5"
        />
      </FieldRow>

      {/* Prompt selector — only when a prompt library is wired + has entries. */}
      {prompts && prompts.length > 0 ? (
        <FieldRow label="Load prompt">
          <SelectMenu
            options={promptSelectOptions}
            value={promptPick}
            onChange={(v) => void onPickPrompt(v)}
            allLabel="Custom (type your own)"
            minWidth={240}
          />
        </FieldRow>
      ) : null}

      <FieldRow label="System prompt">
        <FieldTextArea
          value={spec.systemPrompt}
          onChange={(v) => {
            set('systemPrompt', v)
            if (promptPick && promptPick !== CUSTOM) setPromptPick(CUSTOM) // editing => now custom
          }}
          rows={6}
        />
      </FieldRow>

      <FieldRow label="Tools">
        <YStack gap="$2">
          <ComboBox
            value={toolDraft}
            onChange={setToolDraft}
            options={toolOptions}
            loading={tools.phase === 'loading'}
            error={tools.phase === 'error' ? `Tool catalog unavailable — type a tool id.` : null}
            onRetry={loadTools}
            placeholder="add a tool — e.g. web.search, code.exec"
            emptyText="Press Add to include what you typed."
          />
          <XStack gap="$2">
            <Button size="$2" chromeless icon={<Plus size={14} />} onPress={() => addTool(toolDraft)} disabled={!toolDraft.trim()}>
              Add tool
            </Button>
          </XStack>
          {spec.tools.length > 0 ? (
            <XStack gap="$1.5" flexWrap="wrap">
              {spec.tools.map((t) => (
                <XStack key={t} items="center" gap="$1" px="$2" py="$1" rounded="$3" bg="$color3" borderWidth={1} borderColor="$borderColor">
                  <Text fontSize="$1" color="$color12">
                    {t}
                  </Text>
                  <Button size="$1" chromeless icon={<X size={11} />} onPress={() => removeTool(t)} aria-label={`Remove ${t}`} />
                </XStack>
              ))}
            </XStack>
          ) : null}
        </YStack>
      </FieldRow>

      <FieldRow label="Description">
        <FieldText value={spec.description} onChange={(v) => set('description', v)} placeholder="What this agent does" />
      </FieldRow>

      {unavailable ? (
        <Card gap="$1.5" p="$3" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor">
          <XStack items="center" gap="$2">
            <Terminal size={14} />
            <Text fontSize="$3" fontWeight="700">
              Agents API isn’t connected on this deployment yet
            </Text>
          </XStack>
          <Text fontSize="$2" color="$color11">
            Your definition wasn’t saved (the `/v1/agents` route isn’t bound here yet). Create with the CLI —{' '}
            <Text fontSize="$1" bg="$color3" px="$1" py="$0.5" rounded="$2">hanzo agents create</Text> — and it appears here once the backend is live.
          </Text>
        </Card>
      ) : null}
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error}
        </Text>
      ) : null}

      <XStack gap="$2" pt="$1">
        {onCancel ? (
          <Button flex={1} chromeless onPress={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
        <Button
          flex={1}
          theme="light"
          icon={busy ? undefined : <Bot size={15} />}
          onPress={() => void submit()}
          disabled={!canSubmit(spec) || busy}
        >
          {busy ? <Spinner size="small" /> : submitLabel}
        </Button>
      </XStack>
    </YStack>
  )
}

const msg = (e: unknown): string =>
  e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
    ? (e as { message: string }).message
    : 'unavailable'
