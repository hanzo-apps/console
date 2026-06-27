'use client'

/**
 * Secrets (KMS) — Hanzo KMS is zero-knowledge: secret names AND values are
 * encrypted on the MPC nodes, and the HTTP surface is get-one / put / rotate /
 * delete under token (ZAP) auth — there is deliberately NO "list every secret
 * value" endpoint, and a browser session cookie is not KMS credentials. So this
 * module does NOT fabricate a secret table. It states the model plainly, probes
 * the real `/v1/kms` surface to report whether it's reachable from this console,
 * and deep-links to the KMS console for actual secret management.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ExternalLink, RefreshCw, ShieldCheck, TriangleAlert, Check } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { restGet, v1Url } from '~/lib/api/client'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'

const KMS_CONSOLE = 'https://kms.hanzo.ai'

type Probe =
  | { phase: 'checking' }
  | { phase: 'reachable' }
  | { phase: 'elevated' }
  | { phase: 'unavailable' }
  | { phase: 'error'; message: string }

function describe(p: Probe): { tone: 'ok' | 'warn'; title: string; body: string } {
  switch (p.phase) {
    case 'checking':
      return { tone: 'warn', title: 'Checking…', body: `Probing ${config.brandName} KMS.` }
    case 'reachable':
      return { tone: 'ok', title: 'KMS reachable', body: 'The KMS surface responded to this console session.' }
    case 'elevated':
      return {
        tone: 'warn',
        title: 'Elevated credentials required',
        body: 'KMS responded but a console session cookie is not KMS authorization. Secret access uses token / ZAP (mnemonic-derived) credentials — manage secrets in the KMS console.',
      }
    case 'unavailable':
      return {
        tone: 'warn',
        title: 'Not routed on this host',
        body: 'The /v1/kms surface is not proxied on this host yet. It appears once the deployment routes /v1/kms to Hanzo KMS.',
      }
    case 'error':
      return { tone: 'warn', title: 'Could not reach KMS', body: p.message }
  }
}

export function KmsModule(_props: { params: Record<string, string> }) {
  const [probe, setProbe] = useState<Probe>({ phase: 'checking' })

  const run = useCallback(() => {
    setProbe({ phase: 'checking' })
    // Hit the canonical org-scoped secrets path. There is no list endpoint, so
    // any 2xx is unexpected-but-fine; 401/403 means "reachable, needs token";
    // 404 means "not routed here". Either way we never render secret values.
    restGet(v1Url(`kms/orgs/${encodeURIComponent(config.iamOrgName)}/secrets/`))
      .then(() => setProbe({ phase: 'reachable' }))
      .catch((e) => {
        const status = e instanceof ApiError ? e.status : 0
        if (status === 401 || status === 403) setProbe({ phase: 'elevated' })
        else if (status === 404) setProbe({ phase: 'unavailable' })
        else setProbe({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
      })
  }, [])

  useEffect(() => {
    run()
  }, [run])

  const open = () => {
    if (typeof window !== 'undefined') window.open(KMS_CONSOLE, '_blank', 'noopener')
  }

  const d = describe(probe)

  return (
    <>
      <PageHeader
        title="Secrets"
        subtitle="Encryption keys and secrets, managed by Hanzo KMS."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>
              Recheck
            </Button>
            <Button icon={<ExternalLink size={15} />} onPress={open}>
              KMS console
            </Button>
          </XStack>
        }
      />

      <Card p="$4" gap="$2.5" borderWidth={1} borderColor="$borderColor" maxWidth={680}>
        <XStack gap="$2" items="center">
          <ShieldCheck size={20} />
          <Text fontSize="$5" fontWeight="700">
            Zero-knowledge by design
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          KMS encrypts both secret names and values on the MPC nodes; nothing is stored or returned
          in plaintext, and there is no endpoint that lists secret values. The console therefore does
          not display a secret table — create, read, rotate, and delete secrets in the KMS console,
          where each value is revealed only on explicit, audited access.
        </Text>
        <XStack>
          <Button self="flex-start" theme="light" iconAfter={<ExternalLink size={15} />} onPress={open}>
            Open KMS console
          </Button>
        </XStack>
      </Card>

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
          endpoint · /v1/kms/orgs/{config.iamOrgName}/secrets
        </Text>
      </Card>
    </>
  )
}
