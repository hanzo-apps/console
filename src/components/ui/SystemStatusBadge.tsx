'use client'

/**
 * System status badge — the console's global health indicator (topbar).
 *
 * A compact dot + label that reflects the OVERALL health of the Hanzo cloud,
 * read from the same-origin `/system-status` BFF (which proxies the brand's
 * Gatus status page — no CORS, no iframe, renders natively). Clicking opens a
 * small panel listing any down components with a link to the full status page.
 *
 * Non-blocking: shows a neutral "Checking…" dot until the first response, polls
 * every 60s, pauses while the tab is hidden, and degrades to a neutral "Status"
 * on any error — it never blocks the shell.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Popover, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { paper } from '~/components/ui/paper'

type Overall = 'operational' | 'degraded' | 'down' | 'unknown'
type DownComponent = { name: string; group: string }
type StatusPayload = {
  overall: Overall
  total: number
  up: number
  down: DownComponent[]
  statusUrl: string
}

// Theme tokens (valid across light/dark) — semantic dot + a short label per state.
const DOT: Record<Overall | 'loading', '$green10' | '$yellow10' | '$red10' | '$color8'> = {
  operational: '$green10',
  degraded: '$yellow10',
  down: '$red10',
  unknown: '$color8',
  loading: '$color8',
}

function labelFor(s: StatusPayload | null, probed: boolean): string {
  // Before the first probe: "Checking…". After a probe that yielded nothing (e.g.
  // /system-status isn't served on this deployment — the go:embed build prunes the
  // BFF route), degrade to a neutral "Status" — never a permanent "Checking…".
  if (!s) return probed ? 'Status' : 'Checking…'
  switch (s.overall) {
    case 'operational':
      return 'All systems operational'
    case 'degraded':
      return `${s.down.length} incident${s.down.length === 1 ? '' : 's'}`
    case 'down':
      return 'Major outage'
    default:
      return 'Status'
  }
}

const POLL_MS = 60_000

export function SystemStatusBadge() {
  const [data, setData] = useState<StatusPayload | null>(null)
  const [probed, setProbed] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusUrl = data?.statusUrl ?? config.statusUrl

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    try {
      const res = await fetch('/system-status', { headers: { accept: 'application/json' } })
      if (res.ok) setData((await res.json()) as StatusPayload)
    } catch {
      // keep the last known state; the badge stays non-blocking
    } finally {
      setProbed(true)
    }
  }, [])

  useEffect(() => {
    void load()
    timer.current = setInterval(() => void load(), POLL_MS)
    const onVisible = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer.current) clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const dot = DOT[data ? data.overall : 'loading']
  const label = labelFor(data, probed)
  const openFull = () => window.open(statusUrl, '_blank', 'noopener,noreferrer')

  return (
    <Popover placement="bottom-end">
      <Popover.Trigger asChild>
        <Button
          size="$2"
          chromeless
          aria-label={`System status: ${label}`}
          hoverStyle={{ bg: '$color4' }}
        >
          <XStack items="center" gap="$2">
            <YStack width={8} height={8} rounded={999} bg={dot} />
            <Text fontSize="$2" color="$color11">
              {label}
            </Text>
          </XStack>
        </Button>
      </Popover.Trigger>
      <Popover.Content {...paper} p="$2" width={280}>
        <YStack gap="$1.5">
          <XStack items="center" gap="$2" px="$2" py="$1">
            <YStack width={8} height={8} rounded={999} bg={dot} />
            <Text fontSize="$2" color="$color12" fontWeight="700">
              {label}
            </Text>
          </XStack>

          {data && data.down.length > 0 ? (
            <YStack gap="$0.5">
              <Text px="$2" fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
                Affected
              </Text>
              {data.down.map((c) => (
                <XStack key={`${c.group}/${c.name}`} items="center" justify="space-between" px="$2" py="$1" gap="$2">
                  <Text fontSize="$2" color="$color12" numberOfLines={1}>
                    {c.name || 'Unknown'}
                  </Text>
                  <Text fontSize="$1" color="$color10" numberOfLines={1}>
                    {c.group}
                  </Text>
                </XStack>
              ))}
            </YStack>
          ) : (
            <Text px="$2" py="$1" fontSize="$2" color="$color10">
              {data && data.overall === 'operational'
                ? `All ${data.total} services operational.`
                : 'Live health of every Hanzo cloud service.'}
            </Text>
          )}

          <XStack height={1} bg="$borderColor" my="$0.5" />
          <Button
            size="$2"
            chromeless
            justify="flex-start"
            iconAfter={<ArrowUpRight size={13} />}
            onPress={openFull}
            aria-label="View full status page"
          >
            <Text fontSize="$2" color="$color11">
              View full status
            </Text>
          </Button>
        </YStack>
      </Popover.Content>
    </Popover>
  )
}
