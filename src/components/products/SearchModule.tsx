'use client'

/**
 * Web Search + Crawl — the console control panel for the LIVE self-hosted web-search
 * product (SearXNG meta-search + Crawl4AI scrape), served by cloud at
 * `/v1/websearch/*`. Self-hosted, no third-party keys.
 *
 * A tabbed product (`:tab` route, like Functions/GPUs/Models): Overview (live health
 * + how it works), Try Search (a REAL search box over `/v1/websearch/search`), API
 * (the two endpoints + copy-paste curl + how to use it in hanzo.chat / via API),
 * Engines (the deployed SearXNG engine set — read-only, ConfigMap-configured), and
 * Settings (the honest deployed config + what is / isn't console-configurable).
 *
 * Honest by construction: the health verdict is a REAL live search probe (there is
 * no dedicated health endpoint), request volume is honestly "not metered yet" (cloud
 * does not emit usage rows for websearch), and scrape is documented but NOT offered
 * as a live try-it (it needs the shared crawl key, not a user session). Every state
 * is loading / real / honest-empty / honest-error — never a fabricated number.
 * Strictly @hanzo/gui v5 shorthands.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { BookOpen, ExternalLink, Globe, Search as SearchIcon } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { WebSearchApi, WEBSEARCH_ENDPOINTS, SEARXNG_ENGINES, type SearchResult, type WebSearchEndpoint } from '~/lib/api/websearch'
import {
  SEARCH_TABS,
  resolveTab,
  deriveSearchHealth,
  searchHealthLabel,
  curlFor,
  hostOf,
  presentableResults,
  type SearchHealth,
} from './search/logic'
import { BackendStateCard, PageHeader, StatusTag, classifyBackend, type BackendState } from '@hanzo/ui/product'

const openExternal = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

// Browser: the console's own origin (the session-callable form). SSR/build fallback:
// the ONE Hanzo API endpoint — never a per-service host.
const originNow = (): string => (typeof window !== 'undefined' ? window.location.origin : 'https://api.hanzo.ai')

/** A small labelled fact row (label left, value right / below). */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <XStack justify="space-between" gap="$3" flexWrap="wrap">
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" fontWeight="600">
        {value}
      </Text>
    </XStack>
  )
}

/** A monospace, copy-selectable code block (curl examples). */
function Code({ children }: { children: string }) {
  return (
    <YStack bg="$color2" borderWidth={1} borderColor="$borderColor" rounded="$4" p="$3" overflow="hidden">
      <Text fontSize="$1" color="$color12" selectable style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        {children}
      </Text>
    </YStack>
  )
}

/** A section card with a title + body. */
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
      <YStack gap="$1">
        <Text fontSize="$4" fontWeight="700" color="$color12">
          {title}
        </Text>
        {subtitle ? (
          <Text fontSize="$2" color="$color10">
            {subtitle}
          </Text>
        ) : null}
      </YStack>
      {children}
    </Card>
  )
}

/** Overview — live health probe + how-it-works. The probe is a REAL search. */
function OverviewTab({ health }: { health: SearchHealth }) {
  const verdict = searchHealthLabel(health)
  return (
    <YStack gap="$4">
      <Section title="Status" subtitle="Health is derived from a live search probe — there is no dedicated health endpoint.">
        <XStack items="center" gap="$3" flexWrap="wrap">
          <StatusTag status={verdict.tone === 'green' ? 'healthy' : verdict.tone === 'yellow' ? 'degraded' : verdict.tone === 'red' ? 'down' : ''} />
          <Text fontSize="$3" color="$color12" fontWeight="600">
            {verdict.label}
          </Text>
          {health === 'unknown' ? <Spinner size="small" color="$color10" /> : null}
        </XStack>
        <YStack gap="$2" pt="$2">
          <Fact label="Search engine" value="SearXNG (self-hosted)" />
          <Fact label="Scrape engine" value="Crawl4AI (self-hosted)" />
          <Fact label="Third-party keys" value="None — fully self-hosted" />
          <Fact label="Request metering" value="Not metered yet (infrastructure service)" />
        </YStack>
      </Section>

      <Section title="How it works" subtitle="One self-hosted pipeline, two capabilities.">
        <YStack gap="$2">
          <Text fontSize="$2" color="$color11">
            • Web Search proxies your query to a self-hosted SearXNG meta-search across {SEARXNG_ENGINES.length} key-less
            engines (Google, Bing, DuckDuckGo, Brave, Wikipedia, and more) and returns ranked results.
          </Text>
          <Text fontSize="$2" color="$color11">
            • Crawl extracts any page to clean, LLM-ready markdown via a self-hosted Crawl4AI (Firecrawl-compatible).
          </Text>
          <Text fontSize="$2" color="$color11">
            • In {config.brandName === 'Hanzo Cloud' ? 'hanzo.chat' : 'Chat'}, turn on the Web Search toggle in the composer
            and the assistant grounds its answers with live results + scraped pages.
          </Text>
        </YStack>
      </Section>
    </YStack>
  )
}

/** Try Search — a REAL search box over `/v1/websearch/search`. */
function TrySearchTab({ onProbe }: { onProbe: (r: { ok: boolean; results: number }) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<BackendState | null>(null)

  const run = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    try {
      const hits = await WebSearchApi.search(q)
      setResults(hits)
      onProbe({ ok: true, results: hits.length })
    } catch (e) {
      setResults(null)
      setError(classifyBackend(e))
      onProbe({ ok: false, results: 0 })
    } finally {
      setLoading(false)
    }
  }, [query, onProbe])

  const shown = results ? presentableResults(results) : []

  return (
    <YStack gap="$4">
      <Section title="Try a live search" subtitle="Runs against the self-hosted SearXNG over /v1/websearch/search — real results.">
        <XStack gap="$2" flexWrap="wrap">
          <Input
            flex={1}
            minW={220}
            size="$3"
            placeholder="Search the web…"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void run()}
          />
          <Button size="$3" theme="light" icon={<SearchIcon size={15} />} disabled={loading || !query.trim()} onPress={() => void run()}>
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </XStack>
      </Section>

      {error ? (
        <BackendStateCard state={error} onRetry={() => void run()} hint="endpoint · GET /v1/websearch/search" />
      ) : loading ? (
        <XStack items="center" gap="$2" p="$3">
          <Spinner size="small" color="$color10" />
          <Text fontSize="$2" color="$color10">
            Searching the web…
          </Text>
        </XStack>
      ) : results === null ? (
        <Text fontSize="$2" color="$color10" p="$2">
          Enter a query and run a live search.
        </Text>
      ) : shown.length === 0 ? (
        <Text fontSize="$2" color="$color10" p="$2">
          No results for “{query.trim()}”. The pipeline is reachable — try a different query.
        </Text>
      ) : (
        <YStack gap="$2">
          <Text fontSize="$1" color="$color10">
            {shown.length} result{shown.length === 1 ? '' : 's'}
          </Text>
          {shown.map((r) => (
            <Card key={r.url} borderWidth={1} borderColor="$borderColor" p="$3" gap="$1" hoverStyle={{ bg: '$color2' }}>
              <XStack items="center" gap="$2" justify="space-between">
                <Text fontSize="$3" fontWeight="600" color="$color11" numberOfLines={1} flex={1}>
                  {r.title}
                </Text>
                <Button size="$1" chromeless icon={<ExternalLink size={13} />} onPress={() => openExternal(r.url)} aria-label="Open result">
                  Open
                </Button>
              </XStack>
              <Text fontSize="$1" color="$green10" numberOfLines={1}>
                {hostOf(r.url) || r.url}
              </Text>
              {r.content ? (
                <Text fontSize="$2" color="$color11" numberOfLines={3}>
                  {r.content}
                </Text>
              ) : null}
            </Card>
          ))}
        </YStack>
      )}
    </YStack>
  )
}

/** API — the two endpoints, copy-paste curl, and how to use it (chat + API). */
function ApiTab() {
  const origin = originNow()
  return (
    <YStack gap="$4">
      {WEBSEARCH_ENDPOINTS.map((ep: WebSearchEndpoint) => (
        <Section
          key={ep.path}
          title={`${ep.method} ${ep.path}`}
          subtitle={ep.summary}
        >
          <XStack gap="$2" items="center" flexWrap="wrap">
            <Text
              fontSize="$1"
              px="$2"
              py="$1"
              rounded="$10"
              bg={ep.liveInConsole ? '$green4' : '$color4'}
              color="$color12"
              fontWeight="700"
            >
              {ep.liveInConsole ? 'Callable with your session' : 'Server-side key required'}
            </Text>
          </XStack>
          <Code>{curlFor(ep, origin)}</Code>
        </Section>
      ))}

      <Section title="Use it in Chat" subtitle="No API needed — grounded answers in the assistant.">
        <Text fontSize="$2" color="$color11">
          Open Chat, toggle <Text fontWeight="700" color="$color12">Web Search</Text> in the composer, and ask a question.
          The assistant meta-searches the web and scrapes the top pages to ground its answer — all on the self-hosted
          pipeline, no third-party keys.
        </Text>
      </Section>

      <Section title="Self-hosted — no keys" subtitle="Nothing leaves your infrastructure to a third-party search API.">
        <Text fontSize="$2" color="$color11">
          Search runs on a self-hosted SearXNG and crawl on a self-hosted Crawl4AI. Search is reachable with your signed-in
          session (the console mints a short-lived token server-side). Scrape uses a shared server-side crawl key, so it is
          driven by the platform / Chat, not called directly from the browser.
        </Text>
      </Section>
    </YStack>
  )
}

/** Engines — the deployed SearXNG engine set (read-only, ConfigMap-configured). */
function EnginesTab() {
  return (
    <YStack gap="$4">
      <Section title="Search engines" subtitle="The self-hosted SearXNG queries these key-less engines. Read-only — configured in-cluster.">
        <XStack gap="$2" flexWrap="wrap">
          {SEARXNG_ENGINES.map((e) => (
            <Text key={e} fontSize="$2" px="$3" py="$2" rounded="$4" bg="$color3" color="$color12" fontWeight="600">
              {e}
            </Text>
          ))}
        </XStack>
        <Text fontSize="$1" color="$color10" pt="$1">
          {SEARXNG_ENGINES.length} engines enabled. The engine set is managed in the SearXNG configuration (in-cluster), not
          via an API — so it is shown here read-only.
        </Text>
      </Section>
    </YStack>
  )
}

/** Config — the honest deployed config + what is / isn't console-configurable. */
function ConfigTab({ health }: { health: SearchHealth }) {
  const verdict = searchHealthLabel(health)
  return (
    <YStack gap="$4">
      <Section title="Deployment" subtitle="The live self-hosted web-search services (managed by Hanzo).">
        <YStack gap="$2">
          <Fact label="Search service" value="SearXNG (self-hosted)" />
          <Fact label="Crawl service" value="Crawl4AI (self-hosted)" />
          <Fact label="Search endpoint" value="/v1/websearch/search" />
          <Fact label="Scrape endpoint" value="/v1/websearch/scrape" />
          <Fact label="Live status" value={verdict.label} />
        </YStack>
      </Section>

      <Section title="Configuration" subtitle="What is configurable — honestly.">
        <YStack gap="$2">
          <Text fontSize="$2" color="$color11">
            • The enabled engine set + the SearXNG instance are configured in-cluster (managed by Hanzo) — read-only here.
          </Text>
          <Text fontSize="$2" color="$color11">
            • Web search is a shared, self-hosted infrastructure service — there is no per-org quota or key to manage today.
          </Text>
          <Text fontSize="$2" color="$color11">
            • Usage is not metered yet, so there is no per-org request/cost breakdown to show. This page will surface real
            volume the moment metering is wired.
          </Text>
        </YStack>
      </Section>
    </YStack>
  )
}

export function SearchModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const pathname = usePathname()
  // ONE module renders both the `/websearch` and `/crawl` products, so the base path
  // (and every tab/CTA push) must derive from the CURRENT route — a hardcoded
  // `/websearch` navigated the Crawl page's tabs away to Web Search.
  const base = `/${(pathname ?? '').split('/').filter(Boolean)[0] || 'websearch'}`
  const tab = resolveTab(params.tab)
  // Only Crawl has a docs page (`/docs/crawl`); Web Search has none → the docs root.
  const docsHref = base === '/crawl' ? `${config.docsUrl}/docs/crawl` : `${config.docsUrl}/docs`

  // A single live probe drives the health verdict shown on Overview + Settings. It
  // is a REAL search (there is no health endpoint); a Try-Search run also updates it.
  const [probe, setProbe] = useState<{ ok: boolean; results: number } | null>(null)
  const health = deriveSearchHealth(probe)

  const onProbe = useCallback((r: { ok: boolean; results: number }) => setProbe(r), [])

  useEffect(() => {
    let cancelled = false
    // Probe once on mount with a stable query so the badge reflects reality, not a
    // guess. A failure sets `down`; a success (any result count) sets healthy/reachable.
    void WebSearchApi.search('hanzo ai')
      .then((hits) => {
        if (!cancelled) setProbe({ ok: true, results: hits.length })
      })
      .catch(() => {
        if (!cancelled) setProbe({ ok: false, results: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <PageHeader
        title="Web Search + Crawl"
        subtitle="Self-hosted web search (SearXNG) and web-to-markdown crawl (Crawl4AI) — no third-party keys."
        actions={
          <>
            <Button size="$3" chromeless icon={<BookOpen size={15} />} onPress={() => openExternal(docsHref)}>
              Documentation
            </Button>
            <Button size="$3" theme="light" icon={<SearchIcon size={15} />} onPress={() => router.push(`${base}/search`)}>
              Try a search
            </Button>
          </>
        }
      />

      {/* Brand tag — self-hosted badge */}
      <XStack items="center" gap="$2">
        <Text fontSize="$2" px="$2" py="$1" rounded="$10" bg="$color4" color="$color12" fontWeight="800">
          Web Search
        </Text>
        <Globe size={14} color="$color10" />
        <Text fontSize="$1" color="$color10">
          Self-hosted · SearXNG + Crawl4AI
        </Text>
      </XStack>

      {/* Tab strip */}
      <XStack gap="$1" flexWrap="wrap">
        {SEARCH_TABS.map((t) => (
          <Button
            key={t.id || 'overview'}
            size="$2"
            bg={t.id === tab ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => router.push(t.id ? `${base}/${t.id}` : base)}
          >
            {t.label}
          </Button>
        ))}
      </XStack>

      {tab === '' ? (
        <OverviewTab health={health} />
      ) : tab === 'search' ? (
        <TrySearchTab onProbe={onProbe} />
      ) : tab === 'api' ? (
        <ApiTab />
      ) : tab === 'engines' ? (
        <EnginesTab />
      ) : (
        <ConfigTab health={health} />
      )}
    </>
  )
}
