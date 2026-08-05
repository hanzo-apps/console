'use client'

/**
 * App Store — browse the LIVE 1000+-app open-source catalog and deploy any of them to your
 * Hanzo Cloud in one click. The catalog is fetched DIRECTLY from the public CDN
 * (`config.ossCatalogUrl`/meta.json, open CORS) so it works in the go:embed console with no
 * BFF; deploy reuses the real PaaS path (`PaasApi`). Honest by construction: loading /
 * error / empty are real states, and the maker "Earn 20%" hook routes to the in-console
 * OSS Author program — never fabricated data, never a dead link.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { HandCoins, RefreshCw, Store } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { fetchOssApps, type OssApp } from '~/lib/api/oss-apps'
import { StoreGrid } from './StoreGrid'
import { BackendStateCard, PageHeader, PrimaryButton, classifyBackend, type BackendState } from '@hanzo/ui/product'

type Async =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; apps: OssApp[] }

/**
 * The maker payout banner — the ONE place the Author program is pitched (it used to
 * repeat on every tile, which read as noise and buried the apps).
 *
 * Addressed to the developer, not to the catalog: "Built one of these?" implicitly
 * conceded that we built none of it, framing our own store as other people's work.
 * The subject is the reader's project and what they earn from it.
 */
function PayoutBanner() {
  const router = useRouter()
  return (
    <Card bg="$color2" borderWidth={1} borderColor="$borderColor" p="$4" gap="$2">
      <XStack gap="$3" items="center" flexWrap="wrap">
        <HandCoins size={22} color="$color11" />
        <YStack flex={1} minW={240} gap="$0.5">
          <Text fontSize="$4" fontWeight="700">
            Open source developer? Earn up to 20%.
          </Text>
          <Text fontSize="$2" color="$color11">
            Every time a team runs your project on {config.brandName}, you earn up to 20% of the
            compute margin — paid to your Hanzo wallet, for as long as it runs.
          </Text>
        </YStack>
        <PrimaryButton size="$2" onPress={() => router.push('/authors')}>
          Claim your project
        </PrimaryButton>
      </XStack>
    </Card>
  )
}

export function StoreModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<Async>({ phase: 'loading' })

  const load = useCallback((force = false) => {
    setState({ phase: 'loading' })
    fetchOssApps(config.ossCatalogUrl, force)
      .then((apps) => setState({ phase: 'ready', apps }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <YStack gap="$4">
      <PageHeader
        title="App Store"
        subtitle={`Deploy 1000+ open-source apps — Postgres, n8n, Grafana, and more — to your ${config.brandName} in one click.`}
        actions={
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => load(true)}>
            Refresh
          </Button>
        }
      />

      <PayoutBanner />

      {state.phase === 'loading' ? (
        <Text color="$color11" py="$4">
          Loading the open-source catalog…
        </Text>
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={() => load(true)} hint={`catalog · ${config.ossCatalogUrl}/meta.json`} />
      ) : state.apps.length === 0 ? (
        <XStack gap="$2" items="center" py="$4">
          <Store size={18} color="$color10" />
          <Text color="$color10">The catalog is empty right now. Try refreshing.</Text>
        </XStack>
      ) : (
        <StoreGrid apps={state.apps} base={config.ossCatalogUrl} />
      )}
    </YStack>
  )
}
