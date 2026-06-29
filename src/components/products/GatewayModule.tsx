'use client'

/**
 * Gateway — the in-console management view for the unified, gated, priced API
 * gateway (api.hanzo.ai). The nav entry used to open the bare API origin in a
 * new tab; the bare origin is the API itself, not a UI, so it was a dead-end for
 * a human. This is the real landing: it names the OpenAI-compatible base URL and
 * routes to the console surfaces that actually manage the gateway — Models
 * (routing), Providers (upstreams + credentials), API Keys (credentials), and
 * the Playground (try it) — plus the API reference. No fabricated data.
 */
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Network, Brain, Server, KeySquare, Play, ExternalLink, ArrowUpRight } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'

/** Public gateway origin (a product domain, not a secret). */
const GATEWAY_ORIGIN = 'https://api.hanzo.ai'
/** OpenAI-compatible base the SDKs/CLI point at. */
const GATEWAY_BASE = `${GATEWAY_ORIGIN}/v1`
/** API reference (a real docs UI page). */
const API_REFERENCE = 'https://docs.hanzo.ai/api'

type ManageLink = {
  id: string
  label: string
  description: string
  icon: typeof Network
}

/** The in-console surfaces that manage the gateway. Each routes to its module. */
const MANAGE: ManageLink[] = [
  { id: 'models', label: 'Models', description: 'Model catalog and routing policy across providers.', icon: Brain },
  { id: 'providers', label: 'Providers', description: 'Upstream model providers and their credentials.', icon: Server },
  { id: 'api-keys', label: 'API Keys', description: 'The credential your SDKs, CLI, and apps present.', icon: KeySquare },
  { id: 'playground', label: 'Playground', description: 'Try a model against the live gateway.', icon: Play },
]

export function GatewayModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const openExternal = (href: string) => {
    if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
  }

  return (
    <>
      <PageHeader
        title="Gateway"
        subtitle="The unified, gated, priced API gateway — one OpenAI-compatible endpoint for every model."
        actions={
          <Button icon={<ExternalLink size={16} />} onPress={() => openExternal(API_REFERENCE)}>
            API reference
          </Button>
        }
      />

      {/* ── Endpoint ──────────────────────────────────────────────────────── */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
        <XStack items="center" gap="$2">
          <Network size={18} />
          <Text fontSize="$5" fontWeight="700">
            Base URL
          </Text>
        </XStack>
        <Card bg="$color2" p="$3" rounded="$4" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$4" color="$color12">
            {GATEWAY_BASE}
          </Text>
        </Card>
        <Text fontSize="$3" color="$color11">
          Point any OpenAI-compatible SDK at this base and authenticate with a Hanzo API key
          (Bearer). Requests are authenticated, rate-limited, priced, and routed to the configured
          provider. Generate a key under API Keys.
        </Text>
      </Card>

      {/* ── Manage ────────────────────────────────────────────────────────── */}
      <Text fontSize="$5" fontWeight="700" mt="$2">
        Manage the gateway
      </Text>
      <XStack flexWrap="wrap" gap="$3">
        {MANAGE.map((m) => {
          const Icon = m.icon
          return (
            <Card
              key={m.id}
              p="$4"
              gap="$2"
              width={320}
              borderWidth={1}
              borderColor="$borderColor"
              hoverStyle={{ borderColor: '$color8' }}
              cursor="pointer"
              onPress={() => router.push(`/${m.id}`)}
            >
              <XStack items="center" gap="$2">
                <Icon size={18} />
                <Text fontSize="$4" fontWeight="700">
                  {m.label}
                </Text>
                <ArrowUpRight size={14} color="$color10" />
              </XStack>
              <Text fontSize="$3" color="$color11">
                {m.description}
              </Text>
            </Card>
          )
        })}
      </XStack>
    </>
  )
}
