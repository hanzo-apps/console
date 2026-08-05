'use client'

/**
 * Bot — live status + operator deep-links for the Hanzo Bot gateway.
 *
 * The bot backend (hanzoai/bot → bot-gateway) is a routed service behind the
 * unified gateway at /v1/bot/* — an OpenAI-compatible agent gateway with
 * channels, skills, and a control UI. This console surface reports liveness from
 * /v1/bot/health and links out to the operational surfaces. The bot's own UI is
 * IAM-gated to its own origins, so the console deep-links rather than iframes it.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { ApiError, BotApi } from '~/lib/api'
import { PageHeader, StatusTag } from '@hanzo/ui/product'

/** Operator surfaces for the bot — public product domains, opened in a tab. */
const SURFACES: ReadonlyArray<{ label: string; href: string; hint: string }> = [
  { label: 'Open Bot', href: 'https://hanzo.bot', hint: 'Bot home — channels, skills, marketplace.' },
  { label: 'Control UI', href: 'https://bot.hanzo.ai/__bot__/', hint: 'Live agent canvas and gateway control.' },
  { label: 'Docs', href: 'https://docs.hanzo.bot', hint: 'Build skills, channels, and plugins.' },
  { label: 'Source', href: 'https://github.com/hanzoai/bot', hint: 'hanzoai/bot' },
]

const openTab = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

export function BotModule() {
  const [status, setStatus] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const h = await BotApi.health()
      setStatus(h.status || (h.ok ? 'ok' : 'unknown'))
    } catch (e) {
      // 404 = the bot gateway is not routed on this console's /v1 host (it runs
      // behind the unified gateway at hanzo.bot / api.hanzo.ai). That is an
      // honest "not routed here" state, not a failure — the deep-links still work.
      if (e instanceof ApiError && e.status === 404) {
        setStatus('not routed')
        setErr('The bot gateway is not routed on this host. It runs at hanzo.bot — open it below.')
      } else {
        setStatus('error')
        setErr(e instanceof ApiError ? e.message : 'Failed to reach the bot gateway')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <YStack p="$6" gap="$5" maxW={820}>
      <PageHeader
        title="Bot"
        subtitle="Agent gateway — channels, skills, and an OpenAI-compatible API, served at /v1/bot."
        actions={
          <Button
            size="$2"
            chromeless
            icon={<RefreshCw size={15} />}
            onPress={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
        }
      />

      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$3">
          <Text fontSize="$3" fontWeight="700" color="$color11">
            Gateway
          </Text>
          <StatusTag status={loading ? 'pending' : status} />
          <Text fontSize="$2" color="$color10">
            /v1/bot/health
          </Text>
        </XStack>
        {err ? (
          <Text fontSize="$2" color="$color11">
            {err}
          </Text>
        ) : null}
      </Card>

      <YStack gap="$3">
        {SURFACES.map((s) => (
          <Card key={s.href} p="$4" borderWidth={1} borderColor="$borderColor">
            <XStack justify="space-between" items="center" gap="$4">
              <YStack gap="$1" flex={1}>
                <Text fontWeight="700">{s.label}</Text>
                <Text fontSize="$2" color="$color11">
                  {s.hint}
                </Text>
              </YStack>
              <Button size="$3" onPress={() => openTab(s.href)}>
                Open
              </Button>
            </XStack>
          </Card>
        ))}
      </YStack>
    </YStack>
  )
}
