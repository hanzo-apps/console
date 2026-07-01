'use client'

/**
 * Agents — the New-Agent create form and the per-agent detail view, both rendered
 * inside the shared right-side `DetailPane`. The create form POSTs the REAL
 * `/v1/agents` create; when that route isn't bound yet it 404s and the form shows an
 * honest "not connected — create with the CLI" note instead of pretending to work.
 * The detail view renders the agent's REAL facts (+ best-effort recent activity from
 * `GET /v1/agents/{id}`), never fabricated telemetry.
 */
import { useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Bot, Terminal } from '@hanzogui/lucide-icons-2'

import {
  AgentsApi,
  fmtAbs,
  fmtCompact,
  fmtDuration,
  fmtPct,
  fmtRelative,
  fmtVersion,
  type Agent,
  type AgentActivity,
  type NewAgentBody,
} from '~/lib/api/agents'
import { classifyBackend } from '~/components/ui/BackendState'
import { FieldRow, FieldText, FieldTextArea } from '~/components/ui/Field'
import { StatusPill, ActivityFeed } from './parts'

const DASH = '—'

/** A label · value fact row inside the detail pane. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <XStack justify="space-between" gap="$3" py="$1.5" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" fontWeight="600" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

/**
 * The New-Agent form. Submits `POST /v1/agents`; on success calls `onCreated` (the
 * board reloads + the pane closes). A 404/unavailable backend degrades to an honest
 * note — the console never fakes a create.
 */
export function NewAgentForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [body, setBody] = useState<NewAgentBody>({ name: '', model: '', description: '', systemPrompt: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  const set = <K extends keyof NewAgentBody>(k: K, v: NewAgentBody[K]) => setBody((b) => ({ ...b, [k]: v }))
  const canSubmit = body.name.trim().length > 0 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    setUnavailable(false)
    try {
      await AgentsApi.create({
        name: body.name.trim(),
        model: body.model?.trim() || undefined,
        description: body.description?.trim() || undefined,
        systemPrompt: body.systemPrompt?.trim() || undefined,
      })
      onCreated()
    } catch (e) {
      const state = classifyBackend(e)
      if (state.kind === 'unavailable') setUnavailable(true)
      else setError(state.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <YStack gap="$3">
      <Text fontSize="$2" color="$color11">
        An agent is a model, a system prompt, and a set of tools that runs on Hanzo compute and calls your APIs on
        its own.
      </Text>

      <FieldRow label="Name">
        <FieldText value={body.name} onChange={(v) => set('name', v)} placeholder="support-triage" />
      </FieldRow>
      <FieldRow label="Model">
        <FieldText value={body.model ?? ''} onChange={(v) => set('model', v)} placeholder="zen-omni · gpt-4o-mini · claude-sonnet-4-5" />
      </FieldRow>
      <FieldRow label="Description">
        <FieldText value={body.description ?? ''} onChange={(v) => set('description', v)} placeholder="What this agent does" />
      </FieldRow>
      <FieldRow label="System prompt">
        <FieldTextArea value={body.systemPrompt ?? ''} onChange={(v) => set('systemPrompt', v)} rows={6} />
      </FieldRow>

      {unavailable ? (
        <YStack gap="$1.5" p="$3" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor">
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
        </YStack>
      ) : null}
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error}
        </Text>
      ) : null}

      <XStack gap="$2" pt="$1">
        <Button flex={1} chromeless onPress={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button flex={1} theme="light" icon={busy ? undefined : <Bot size={15} />} onPress={() => void submit()} disabled={!canSubmit}>
          {busy ? <Spinner size="small" /> : 'Create agent'}
        </Button>
      </XStack>
    </YStack>
  )
}

/**
 * The per-agent detail view — REAL facts from the row, enriched best-effort with the
 * recent-activity feed from `GET /v1/agents/{id}` (silent honest-empty when unbound).
 */
export function AgentDetailView({ agent }: { agent: Agent }) {
  const [activity, setActivity] = useState<AgentActivity[] | null>(null)

  useEffect(() => {
    let live = true
    AgentsApi.get(agent.id)
      .then((d) => {
        if (live) setActivity(d?.recentActivity ?? [])
      })
      .catch(() => {
        if (live) setActivity([])
      })
    return () => {
      live = false
    }
  }, [agent.id])

  return (
    <YStack gap="$3">
      <XStack items="center" gap="$2">
        <StatusPill status={agent.status} />
        <Text fontSize="$1" color="$color10">
          {fmtVersion(agent.version)}
        </Text>
      </XStack>

      {agent.description ? (
        <Text fontSize="$2" color="$color11">
          {agent.description}
        </Text>
      ) : null}

      <YStack gap="$1">
        <Fact label="Model" value={agent.model || DASH} />
        <Fact label="Invocations 30d" value={fmtCompact(agent.invocations30d)} />
        <Fact label="Success rate" value={fmtPct(agent.successRate)} />
        <Fact label="Avg latency" value={fmtDuration(agent.avgLatencyMs)} />
        <Fact label="Errors 30d" value={fmtCompact(agent.errors30d)} />
        <Fact label="Tools" value={agent.tools != null ? String(agent.tools) : DASH} />
        <Fact label="Last invocation" value={fmtRelative(agent.lastInvocationAt)} />
        <Fact label="Created" value={fmtAbs(agent.createdAt)} />
        <Fact label="Updated" value={fmtAbs(agent.updatedAt)} />
        <Fact label="Agent ID" value={agent.id} />
      </YStack>

      <YStack gap="$2" pt="$1">
        <Text fontSize="$3" fontWeight="700" color="$color12">
          Recent activity
        </Text>
        {activity === null ? (
          <XStack py="$3" justify="center">
            <Spinner size="small" color="$color11" />
          </XStack>
        ) : (
          <ActivityFeed events={activity} />
        )}
      </YStack>
    </YStack>
  )
}
