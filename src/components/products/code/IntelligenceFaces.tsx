'use client'

/**
 * The two code-intelligence faces of the Code hub — SEARCH (hybrid cross-repo retrieval)
 * and ASK (cited RAG answer) — over the REAL per-org `/v1/code` engine (`CodeApi`,
 * org-scoped SERVER-SIDE; no org param leaves the browser). Ported from the former
 * standalone Code module, with ONE unifying change: a search hit and an answer citation
 * both DEEP-LINK into the hub's repo browser at the exact file (`repoFileHref`) — so
 * "found some code" flows straight to "read it in context", the same browser the Repos
 * face opens. No fabricated results: honest not-connected (404), error, and empty states.
 *
 * `/v1/code` indexes a repo on push; a freshly MIRRORED repo becomes searchable after its
 * next push — the empty state says so honestly rather than implying the repo is missing.
 */
import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ScanSearch, Search, Sparkles, TriangleAlert } from '@hanzogui/lucide-icons-2'

import {
  CodeApi,
  searchFacets,
  spanKey,
  SEARCH_TYPES,
  SEARCH_TYPE_LABEL,
  type AskResult,
  type Citation,
  type SearchResult,
  type SearchType,
  type Span,
} from '~/lib/api/code'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { KindBadge, Panel, RefButton, ScoreBar, SnippetLine, TierBadge, CitationRow } from './parts'
import { repoFileHref } from './hub-logic'

/** A quiet, honest "not connected on this deployment" note (a 404 on the /v1/code route). */
function NotConnected({ what }: { what: string }) {
  return (
    <YStack items="center" gap="$1" py="$5">
      <Text fontSize="$3" color="$color11" fontWeight="600">
        Code intelligence isn’t connected here yet
      </Text>
      <Text fontSize="$2" color="$color10" text="center" maxW={480}>
        The {what} route isn’t mounted on this deployment. It lights up automatically once it’s live — nothing is fabricated.
      </Text>
    </YStack>
  )
}

// ── Search face ──────────────────────────────────────────────────────────────

export function SearchFace({ scope }: { scope: string }) {
  const router = useRouter()

  const [sInput, setSInput] = useState('')
  const [sType, setSType] = useState<SearchType>('hybrid')
  const [sQuery, setSQuery] = useState('') // the last SUBMITTED query
  const [searching, setSearching] = useState(false)
  const [sResult, setSResult] = useState<SearchResult | null>(null)
  const [sError, setSError] = useState<BackendState | null>(null)
  const [sRan, setSRan] = useState(false)

  const doSearch = useCallback(
    async (query: string, type: SearchType) => {
      const q = query.trim()
      if (!q) return
      setSearching(true)
      setSError(null)
      setSRan(true)
      setSType(type)
      setSQuery(q)
      try {
        setSResult(await CodeApi.search(q, type, scope.trim() || undefined))
      } catch (e) {
        setSResult(null)
        setSError(classifyBackend(e))
      } finally {
        setSearching(false)
      }
    },
    [scope],
  )

  const facets = useMemo(() => searchFacets(sResult?.results ?? []), [sResult])

  /** Open a hit in the hub's repo browser at its file (the search→browse seam). */
  const openSpan = useCallback(
    (s: Span) => {
      if (s.repo && s.file) router.push(repoFileHref(s.repo, s.file))
    },
    [router],
  )

  const columns: Column<Span>[] = [
    {
      key: 'loc',
      header: 'Location',
      render: (s) => (
        <YStack minW={0} gap="$0.5">
          <RefButton loc={s} onPress={s.repo && s.file ? () => openSpan(s) : undefined} />
          {s.repo ? (
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {s.repo}
            </Text>
          ) : null}
        </YStack>
      ),
    },
    {
      key: 'symbol',
      header: 'Symbol',
      width: 200,
      render: (s) => (
        <XStack items="center" gap="$1.5" minW={0}>
          <KindBadge kind={s.kind} />
          <Text className="hz-mono" fontSize="$2" color="$color12" numberOfLines={1}>
            {s.symbol || '—'}
          </Text>
        </XStack>
      ),
    },
    { key: 'snippet', header: 'Snippet', render: (s) => <SnippetLine text={s.snippet} /> },
    { key: 'score', header: 'Score', width: 96, align: 'right', render: (s) => <ScoreBar score={s.score} max={facets.maxScore} /> },
    { key: 'tier', header: 'Tier', width: 116, render: (s) => <TierBadge tier={s.tier} /> },
  ]

  return (
    <Panel title="Search">
      <XStack gap="$2" flexWrap="wrap" items="center">
        <XStack items="center" gap="$2" flex={1} minW={240} px="$3" borderWidth={1} borderColor="$borderColor" rounded="$3">
          <Search size={15} />
          <Input
            flex={1}
            unstyled
            value={sInput}
            onChangeText={setSInput}
            onSubmitEditing={() => void doSearch(sInput, sType)}
            placeholder="Search across every repo — a symbol, a phrase, or a question…"
            autoCapitalize="none"
            py="$2.5"
          />
        </XStack>
        <XStack gap="$1">
          {SEARCH_TYPES.map((t) => (
            <Button
              key={t}
              size="$2"
              bg={t === sType ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor="$borderColor"
              onPress={() => (sRan ? void doSearch(sQuery, t) : setSType(t))}
            >
              {SEARCH_TYPE_LABEL[t]}
            </Button>
          ))}
        </XStack>
        <Button size="$3" theme="light" icon={<Search size={15} />} disabled={searching || !sInput.trim()} onPress={() => void doSearch(sInput, sType)}>
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </XStack>

      {searching && !sResult ? (
        <XStack items="center" gap="$2" p="$3">
          <Spinner size="small" color="$color10" />
          <Text fontSize="$2" color="$color10">
            Searching your code…
          </Text>
        </XStack>
      ) : sError ? (
        sError.kind === 'unavailable' ? (
          <NotConnected what="/v1/code/search" />
        ) : (
          <BackendStateCard state={sError} onRetry={() => void doSearch(sQuery || sInput, sType)} hint="endpoint · GET /v1/code/search" />
        )
      ) : sResult ? (
        <YStack gap="$3">
          {sResult.degraded ? (
            <XStack items="center" gap="$2" px="$3" py="$2" rounded="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
              <TriangleAlert size={14} />
              <Text fontSize="$2" color="$color11">
                Retrieval was partially unavailable — results may be incomplete.
              </Text>
            </XStack>
          ) : null}

          {sResult.results.length > 0 ? (
            <>
              <XStack gap="$3" flexWrap="wrap" items="center">
                <Text fontSize="$2" color="$color12" fontWeight="700">
                  {facets.count} result{facets.count === 1 ? '' : 's'}
                </Text>
                {facets.repos.length ? (
                  <Text fontSize="$2" color="$color10">
                    {facets.repos.length} repo{facets.repos.length === 1 ? '' : 's'}
                  </Text>
                ) : null}
                {Object.entries(facets.tiers).map(([t, n]) => (
                  <XStack key={t} items="center" gap="$1.5">
                    <TierBadge tier={t} />
                    <Text fontSize="$1" color="$color10">
                      {n}
                    </Text>
                  </XStack>
                ))}
              </XStack>
              <DataTable
                columns={columns}
                rows={sResult.results}
                rowKey={(s) => spanKey(s, sResult.results.indexOf(s))}
                onRowPress={openSpan}
                empty="No matches."
              />
            </>
          ) : (
            <YStack items="center" gap="$1" py="$5">
              <Text fontSize="$3" color="$color11" fontWeight="600">
                No matches for “{sQuery}”
              </Text>
              <Text fontSize="$2" color="$color10" text="center" maxW={520}>
                Repositories are indexed on push — a freshly mirrored repo becomes searchable after its next push. If yours is new, browse it under Repositories or push to it, and matches appear here.
              </Text>
            </YStack>
          )}
        </YStack>
      ) : (
        <YStack items="center" gap="$2" py="$6">
          <ScanSearch size={22} color="$color9" />
          <Text fontSize="$3" color="$color11" fontWeight="600">
            Search across every repository
          </Text>
          <Text fontSize="$2" color="$color10" text="center" maxW={480}>
            Hybrid retrieval over your organization’s code — lexical text, symbol lookup, and semantic (embedding) search, fused. Enter a query to begin.
          </Text>
        </YStack>
      )}
    </Panel>
  )
}

// ── Ask face ─────────────────────────────────────────────────────────────────

export function AskFace({ scope }: { scope: string }) {
  const router = useRouter()

  const [aInput, setAInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [aResult, setAResult] = useState<AskResult | null>(null)
  const [aError, setAError] = useState<BackendState | null>(null)

  const doAsk = useCallback(
    async (query: string) => {
      const q = query.trim()
      if (!q) return
      setAsking(true)
      setAError(null)
      try {
        setAResult(await CodeApi.ask(q, scope.trim() || undefined))
      } catch (e) {
        setAResult(null)
        setAError(classifyBackend(e))
      } finally {
        setAsking(false)
      }
    },
    [scope],
  )

  /** A citation opens the cited file in the hub's repo browser (ask→browse seam). */
  const onCite = useCallback(
    (c: Citation) => {
      if (c.repo && c.file) router.push(repoFileHref(c.repo, c.file))
    },
    [router],
  )

  return (
    <Panel title="Ask">
      <XStack gap="$2" flexWrap="wrap" items="center">
        <XStack items="center" gap="$2" flex={1} minW={240} px="$3" borderWidth={1} borderColor="$borderColor" rounded="$3">
          <Sparkles size={15} />
          <Input
            flex={1}
            unstyled
            value={aInput}
            onChangeText={setAInput}
            onSubmitEditing={() => void doAsk(aInput)}
            placeholder="Ask about your codebase — “where is auth validated?”"
            autoCapitalize="none"
            py="$2.5"
          />
        </XStack>
        <Button size="$3" theme="light" icon={<Sparkles size={15} />} disabled={asking || !aInput.trim()} onPress={() => void doAsk(aInput)}>
          {asking ? 'Asking…' : 'Ask'}
        </Button>
      </XStack>

      {asking ? (
        <XStack items="center" gap="$2" p="$3">
          <Spinner size="small" color="$color10" />
          <Text fontSize="$2" color="$color10">
            Reading your code…
          </Text>
        </XStack>
      ) : aError ? (
        aError.kind === 'unavailable' ? (
          <NotConnected what="/v1/code/ask" />
        ) : (
          <BackendStateCard state={aError} onRetry={() => void doAsk(aInput)} hint="endpoint · GET /v1/code/ask" />
        )
      ) : aResult ? (
        <YStack gap="$3">
          {aResult.answer ? (
            <Text fontSize="$3" color="$color12" style={{ whiteSpace: 'pre-wrap' }}>
              {aResult.answer}
            </Text>
          ) : (
            <Text fontSize="$2" color="$color10">
              {aResult.degraded
                ? 'Answer synthesis isn’t available on this deployment — the cited spans below are the grounded matches.'
                : 'No answer was produced for this question.'}
            </Text>
          )}
          {aResult.citations.length ? (
            <YStack gap="$2">
              <Text fontSize="$2" color="$color10" fontWeight="600">
                Citations
              </Text>
              {aResult.citations.map((c, i) => (
                <CitationRow key={`${c.file}:${c.line}:${i}`} citation={c} onPress={() => onCite(c)} />
              ))}
            </YStack>
          ) : null}
        </YStack>
      ) : (
        <Text fontSize="$2" color="$color10" p="$1">
          Ask a question about your codebase — you’ll get a cited answer grounded in your indexed code, with each citation linking to the file.
        </Text>
      )}
    </Panel>
  )
}
