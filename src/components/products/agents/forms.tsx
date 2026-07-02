'use client'

/**
 * Agents — the New-Agent form and the per-agent detail view, both rendered inside
 * the shared right-side `DetailPane`.
 *
 * The New-Agent form is now a THIN adapter over the CANONICAL, shareable
 * `AgentBuilder` (`~/components/agent-builder`) — the ONE agent builder across every
 * Hanzo surface. console2 supplies its live `/v1` sources via `agentBuilderLoaders`
 * (model catalog → `/v1/models`, saved prompts → `/v1/prompts`, create →
 * `/v1/agents`); the builder owns the form, the LIVE model + prompt dropdowns, and
 * the honest states. The detail view renders the agent's REAL facts (+ best-effort
 * recent activity from `GET /v1/agents/{id}`), never fabricated telemetry.
 */
import { useEffect, useState } from 'react'
import { Spinner, Text, XStack, YStack } from '@hanzo/gui'

import {
  AgentsApi,
  fmtAbs,
  fmtCompact,
  fmtDuration,
  fmtPct,
  fmtRelative,
  fmtUsd,
  fmtVersion,
  type Agent,
  type AgentActivity,
} from '~/lib/api/agents'
import { fetchUsageRecords, agentUsageFor, type AgentUsage } from '~/lib/api/aimetrics'
import { AgentBuilder } from '~/components/agent-builder'
import { agentBuilderLoaders } from './loaders'
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
 * The New-Agent form — the canonical `AgentBuilder` wired to console2's live `/v1`
 * sources. On a successful `POST /v1/agents` it calls `onCreated` (the board
 * reloads + the pane closes); a 404/unavailable backend degrades to the builder's
 * own honest "not connected — create with the CLI" note.
 */
export function NewAgentForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  return <AgentBuilder loaders={agentBuilderLoaders} onCreated={onCreated} onCancel={onCancel} />
}

/**
 * The per-agent detail view — REAL facts from the row, the agent's REAL cost from
 * the charged commerce ledger (grouped by `metadata.agent`, NOT a hardcoded/registry
 * metric), and a best-effort recent-activity feed from `GET /v1/agents/{id}`.
 */
export function AgentDetailView({ agent }: { agent: Agent }) {
  const [activity, setActivity] = useState<AgentActivity[] | null>(null)
  // `undefined` = still loading; `null` = loaded, ledger carries no row for this
  // agent (honest "—"); an `AgentUsage` = the real charged spend/requests/tokens.
  const [ledger, setLedger] = useState<AgentUsage | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    AgentsApi.get(agent.id)
      .then((d) => {
        if (live) setActivity(d?.recentActivity ?? [])
      })
      .catch(() => {
        if (live) setActivity([])
      })
    // Per-agent cost comes from the SAME charged ledger the Cost page reads — never
    // a fabricated or hardcoded number. A ledger failure degrades to honest "—".
    fetchUsageRecords()
      .then((records) => {
        if (live) setLedger(agentUsageFor(records, { id: agent.id, name: agent.name }))
      })
      .catch(() => {
        if (live) setLedger(null)
      })
    return () => {
      live = false
    }
  }, [agent.id, agent.name])

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
          Cost · charged ledger
        </Text>
        {ledger === undefined ? (
          <XStack py="$3" justify="center">
            <Spinner size="small" color="$color11" />
          </XStack>
        ) : (
          <YStack gap="$1">
            <Fact label="Cost" value={fmtUsd(ledger?.cents)} />
            <Fact label="Requests" value={fmtCompact(ledger?.requests)} />
            <Fact label="Tokens" value={fmtCompact(ledger?.totalTokens)} />
            {ledger === null ? (
              <Text fontSize="$1" color="$color10" pt="$1">
                No charged spend is attributed to this agent yet — cost appears once its usage is metered.
              </Text>
            ) : null}
          </YStack>
        )}
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
