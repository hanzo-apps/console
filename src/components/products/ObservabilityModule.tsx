'use client'

/**
 * Observability — traces, evals, and prompts for AI workloads (HIP-0106). This
 * is the LARGEST old-console surface; porting it natively is staged, so this is
 * the honest first step: it probes the REAL `/v1/o11y` runtime to report status,
 * deep-links to the full observability surface for traces/evals/prompts today,
 * and truthfully marks the in-console native browser as coming. No fabricated
 * charts, no fake spans — only the real runtime status and real links.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, ExternalLink, RefreshCw, Check, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { restGet, v1Url } from '~/lib/api/client'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'

const OBSERVABILITY_URL = 'https://insights.hanzo.ai'

type Status = 'checking' | 'online' | 'not-initialized' | 'unavailable' | 'access' | 'error'

function classify(e: unknown): Status {
  const s = e instanceof ApiError ? e.status : 0
  if (s === 503) return 'not-initialized'
  if (s === 404) return 'unavailable'
  if (s === 401 || s === 403) return 'access'
  return 'error'
}

function describe(status: Status, message: string): { tone: 'ok' | 'warn'; title: string; body: string } {
  switch (status) {
    case 'checking':
      return { tone: 'warn', title: 'Checking…', body: 'Probing the observability runtime.' }
    case 'online':
      return { tone: 'ok', title: 'Runtime online', body: 'The o11y runtime is serving on this host.' }
    case 'not-initialized':
      return {
        tone: 'warn',
        title: 'Runtime not initialized',
        body: 'The /v1/o11y routes are mounted but the observability runtime (telemetry stores, query service) is not initialized on this deployment yet. Use the observability surface below until it is.',
      }
    case 'unavailable':
      return { tone: 'warn', title: 'Not routed on this host', body: 'The /v1/o11y surface is not proxied here yet.' }
    case 'access':
      return { tone: 'warn', title: 'Access required', body: 'Sign in with an account that can read observability data.' }
    case 'error':
      return { tone: 'warn', title: 'Could not reach observability', body: message }
  }
}

/** A deep-link tile for a sub-surface that lives in the observability product. */
function SurfaceTile({ title, body }: { title: string; body: string }) {
  return (
    <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" flex={1} minW={220}>
      <Text fontSize="$5" fontWeight="700">
        {title}
      </Text>
      <Text fontSize="$3" color="$color11" minH={40}>
        {body}
      </Text>
      <XStack>
        <Button
          self="flex-start"
          size="$2"
          iconAfter={<ExternalLink size={14} />}
          onPress={() => {
            if (typeof window !== 'undefined') window.open(OBSERVABILITY_URL, '_blank', 'noopener')
          }}
        >
          Open
        </Button>
      </XStack>
    </Card>
  )
}

export function ObservabilityModule(_props: { params: Record<string, string> }) {
  const [status, setStatus] = useState<Status>('checking')
  const [message, setMessage] = useState('')

  const run = useCallback(() => {
    setStatus('checking')
    setMessage('')
    restGet(v1Url('o11y/traces'))
      .then(() => setStatus('online'))
      .catch((e) => {
        setStatus(classify(e))
        setMessage(e instanceof Error ? e.message : String(e))
      })
  }, [])

  useEffect(() => {
    run()
  }, [run])

  const open = () => {
    if (typeof window !== 'undefined') window.open(OBSERVABILITY_URL, '_blank', 'noopener')
  }
  const d = describe(status, message)

  return (
    <>
      <PageHeader
        title="Observability"
        subtitle="Traces, evals, and prompts for your AI workloads."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>
              Recheck
            </Button>
            <Button icon={<ExternalLink size={15} />} onPress={open}>
              Observability
            </Button>
          </XStack>
        }
      />

      <Card p="$4" gap="$2" borderWidth={1} borderColor={d.tone === 'ok' ? '$color7' : '$borderColor'} maxWidth={680}>
        <XStack gap="$2" items="center">
          {d.tone === 'ok' ? <Check size={16} /> : <TriangleAlert size={16} />}
          <Text fontSize="$4" fontWeight="700">
            {d.title}
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          {d.body}
        </Text>
        <Text fontSize="$2" color="$color10">
          endpoint · /v1/o11y · {config.brandName}
        </Text>
      </Card>

      <XStack gap="$3" flexWrap="wrap">
        <SurfaceTile title="Traces" body="Request and agent traces with spans and latency." />
        <SurfaceTile title="Evals" body="Evaluation runs and scores for model outputs." />
        <SurfaceTile title="Prompts" body="Prompt versions, diffs, and usage." />
      </XStack>

      <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color2" maxWidth={680}>
        <XStack gap="$2" items="center">
          <Activity size={18} />
          <Text fontSize="$4" fontWeight="700">
            Native console browser — coming
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          In-console traces, evals, and prompts (built directly on /v1/o11y, HIP-0106) are on the
          way. Until then, the full observability surface above has everything. This page never shows
          placeholder telemetry.
        </Text>
      </Card>
    </>
  )
}
