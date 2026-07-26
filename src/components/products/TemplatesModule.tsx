'use client'

/**
 * Templates — the Hanzo starter-kit gallery (deployable app/site scaffolds,
 * `hanzoai/gallery`) browsed natively in-console over the REAL cloud
 * `/v1/templates` catalog (`TemplatesApi` → `originV1Url('templates')` → the
 * console's own `/v1` bearer proxy).
 *
 * Each card leads with a visual PREVIEW banner: the gallery screenshot
 * (`t.preview`) when it loads, else a branded gradient tile (stable per category
 * + a framework glyph) — honest by construction, never a broken image, and it
 * auto-upgrades to the real shot the moment the gallery serves it.
 *
 * Two distinct, complementary paths off every card (both offered — one never
 * clobbers the other):
 *   - "Open in builder" (customize): the card takes an optional free-text
 *     customization and deep-links to the hanzo.app builder pre-seeded with this
 *     starter (`buildBuilderUrl` → `<app>/dev?template=…&prompt=…&action=edit`),
 *     which auto-starts the first generation so the user lands on a customized
 *     first edition and can talk-and-edit → deploy.
 *   - "Fork / deploy" (ship as-is): `TemplatesApi.fork` → cloud
 *     `POST /v1/projects/fork` seeds a REAL org-scoped Project (framework mapped,
 *     repo = gallery source); the forked card then offers a one-click "Deploy"
 *     (`POST /v1/projects/{slug}/deploy` {source:'git'}) → building on CI →
 *     "Check status" → "Open site" (liveUrl). Each phase shows exactly ONE next
 *     step, so "how to deploy" is never ambiguous.
 *
 * Every state is honest: loading, the backend-state card on error, a true empty
 * state, per-card idle/forking/forked/deploying/live/error — never a fabricated
 * card. If the fork route is absent (older backend → 404) it falls back to
 * opening the gallery source, so the button is never dead.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight, Check, LayoutTemplate, Loader, RefreshCw, Rocket, Search, Sparkles, X } from '@hanzogui/lucide-icons-2'

import { TemplatesApi, buildBuilderUrl, groupByCategory, isLive, type ForkedProject, type Template } from '~/lib/api/templates'
import { ApiError } from '~/lib/api/client'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

const openSource = (url?: string) => {
  if (url && typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
}

// hueFor — a stable hue (0-359) derived from a label, so each category gets a
// distinct, deterministic gradient for the fallback preview tile.
function hueFor(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

// TemplatePreview — the card's visual banner. Renders the real gallery screenshot
// (`t.preview`) when it loads; otherwise a branded gradient tile (stable per
// category) with the framework + a template glyph. Honest by construction: an
// absent/broken screenshot degrades to a designed placeholder — never a broken
// image — and auto-upgrades to the real shot the moment the gallery serves it.
function TemplatePreview({ t }: { t: Template }) {
  const [broken, setBroken] = useState(false)
  const show = !!t.preview && !broken
  const hue = hueFor(t.category)
  return (
    <div
      style={{
        height: 132,
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid var(--borderColor)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: show
          ? 'var(--color1)'
          : // Monochrome tile — zero-saturation neutrals; the per-category seed varies only
            // the LIGHTNESS (never the hue), so tiles stay distinct but read as one greyscale.
            `linear-gradient(135deg, hsl(0 0% ${14 + (hue % 8)}%), hsl(0 0% ${7 + (hue % 5)}%))`,
      }}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={t.preview}
          alt={`${t.title} preview`}
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 12 }}>
          <LayoutTemplate size={24} color="rgba(255,255,255,0.82)" />
          {t.framework ? (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)' }}>{t.framework}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

// Per-card lifecycle: idle → forking → forked (draft) → deploying → live | error.
// Forking creates a real draft Project; deploying ships it live via projectsvc
// (git build on CI). Each phase shows exactly ONE clear next step, so "how to
// deploy" is never ambiguous. On a 404 fork (older backend without the route) we
// fall back to opening the gallery source, so the button is never dead.
type CardPhase =
  | { phase: 'idle' }
  | { phase: 'forking' }
  | { phase: 'forked'; project: ForkedProject }
  | { phase: 'deploying'; project: ForkedProject }
  | { phase: 'live'; project: ForkedProject; liveUrl: string }
  | { phase: 'error'; message: string }

function TemplateCard({ t }: { t: Template }) {
  const [s, setS] = useState<CardPhase>({ phase: 'idle' })
  // Optional free-text customization the user types before opening the builder.
  const [userText, setUserText] = useState('')

  // Open in builder (the fork → customize loop): deep-links to the hanzo.app
  // builder pre-seeded with this starter + the customization ask. The seed prompt
  // carries the template context, so the builder auto-starts the first generation.
  const openBuilder = useCallback(() => {
    if (typeof window === 'undefined') return
    window.open(buildBuilderUrl(t, userText, config.appUrl), '_blank', 'noopener,noreferrer')
  }, [t, userText])

  const onFork = useCallback(() => {
    setS({ phase: 'forking' })
    TemplatesApi.fork(t.slug)
      .then((project) => {
        if (isLive(project.status, project.liveUrl)) {
          setS({ phase: 'live', project, liveUrl: project.liveUrl! })
        } else {
          setS({ phase: 'forked', project })
        }
      })
      .catch((e) => {
        // Honest fallback: a 404 means this backend has no fork route yet — open
        // the gallery source (the original behavior) instead of showing an error.
        if (e instanceof ApiError && e.status === 404 && t.source) {
          openSource(t.source)
          setS({ phase: 'idle' })
          return
        }
        setS({ phase: 'error', message: e instanceof Error ? e.message : 'Fork failed' })
      })
  }, [t.slug, t.source])

  const onDeploy = useCallback((project: ForkedProject) => {
    setS({ phase: 'deploying', project })
    TemplatesApi.deploy(project.slug)
      .then((result) => {
        if (isLive(result.status, result.liveUrl)) {
          setS({ phase: 'live', project, liveUrl: result.liveUrl! })
        } else if (result.status === 'error') {
          setS({ phase: 'error', message: result.message || 'Deploy failed' })
        } else {
          setS({ phase: 'deploying', project }) // building on CI; poll via "Check status"
        }
      })
      .catch((e) => setS({ phase: 'error', message: e instanceof Error ? e.message : 'Deploy failed' }))
  }, [])

  const onCheck = useCallback((project: ForkedProject) => {
    TemplatesApi.status(project.slug)
      .then((p) => {
        if (p && isLive(p.status, p.liveUrl)) setS({ phase: 'live', project, liveUrl: p.liveUrl! })
      })
      .catch(() => {
        /* leave the deploying state — honest: still building */
      })
  }, [])

  return (
    <Card
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor="$borderColor"
      width={320}
      hoverStyle={{ borderColor: '$color8' }}
    >
      <TemplatePreview t={t} />
      <XStack items="center" justify="space-between" gap="$2">
        <Text fontSize="$4" fontWeight="700" numberOfLines={1}>{t.title}</Text>
        {t.framework ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{t.framework}</Text> : null}
      </XStack>
      {t.description ? (
        <Text fontSize="$2" color="$color11" numberOfLines={2}>{t.description}</Text>
      ) : null}
      {t.features.length ? (
        <XStack gap="$1" flexWrap="wrap">
          {t.features.slice(0, 4).map((f) => (
            <Text key={f} fontSize="$1" color="$color10" bg="$color3" px="$2" py="$1" rounded="$10">{f}</Text>
          ))}
        </XStack>
      ) : null}

      {/* Fork → builder: type an optional customization, then open the builder
          pre-seeded with this starter — it auto-starts the first generation. */}
      <XStack
        items="center"
        gap="$2"
        bg="$color2"
        px="$3"
        rounded="$3"
        borderWidth={1}
        borderColor="$borderColor"
        mt="$1"
      >
        <Input
          unstyled
          placeholder="Customize (optional), e.g. add dark mode"
          value={userText}
          onChangeText={setUserText}
          flex={1}
          py="$2"
          fontSize="$2"
        />
      </XStack>
      <Button size="$2" self="flex-start" icon={<Sparkles size={14} />} onPress={openBuilder}>
        Open in builder
      </Button>

      {s.phase === 'live' ? (
        <YStack gap="$1" mt="$1">
          <XStack items="center" gap="$2">
            <Check size={14} color="var(--green10)" />
            <Text fontSize="$2" color="$color11" numberOfLines={1}>Live</Text>
          </XStack>
          <Button size="$2" self="flex-start" icon={<ArrowUpRight size={14} />} onPress={() => openSource(s.liveUrl)}>
            Open site
          </Button>
        </YStack>
      ) : s.phase === 'deploying' ? (
        <YStack gap="$1" mt="$1">
          <XStack items="center" gap="$2">
            <Loader size={14} color="var(--color10)" />
            <Text fontSize="$2" color="$color11" numberOfLines={1}>
              Deploying “{s.project.name}” — building on CI…
            </Text>
          </XStack>
          <XStack gap="$2" items="center" flexWrap="wrap">
            <Button size="$2" self="flex-start" icon={<RefreshCw size={13} />} onPress={() => onCheck(s.project)}>
              Check status
            </Button>
            <Text fontSize="$1" color="$color10">Goes live shortly.</Text>
          </XStack>
        </YStack>
      ) : s.phase === 'forked' ? (
        <YStack gap="$1" mt="$1">
          <XStack items="center" gap="$2">
            <Check size={14} color="var(--green10)" />
            <Text fontSize="$2" color="$color11" numberOfLines={1}>
              Project “{s.project.name}” created
            </Text>
          </XStack>
          <XStack gap="$2" items="center">
            <Button size="$2" self="flex-start" icon={<Rocket size={14} />} onPress={() => onDeploy(s.project)}>
              Deploy
            </Button>
            <Text fontSize="$1" color="$color10">Ship it live.</Text>
          </XStack>
        </YStack>
      ) : (
        <>
          <Button
            size="$2"
            chromeless
            self="flex-start"
            icon={s.phase === 'forking' ? <Loader size={14} /> : <ArrowUpRight size={14} />}
            disabled={s.phase === 'forking' || (!t.source && !t.slug)}
            onPress={onFork}
          >
            {s.phase === 'forking' ? 'Forking…' : 'Fork / deploy'}
          </Button>
          {s.phase === 'error' ? (
            <Text fontSize="$1" color="$red10" numberOfLines={2}>{s.message}</Text>
          ) : null}
        </>
      )}
    </Card>
  )
}

function TemplatesView() {
  const [state, setState] = useState<Async<Template[]>>({ phase: 'loading' })
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    TemplatesApi.list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const all = state.phase === 'ready' ? state.data : []
  const categories = useMemo(() => groupByCategory(all).map(([c]) => c), [all])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((t) => {
      if (cat && t.category !== cat) return false
      if (!needle) return true
      return (
        t.title.toLowerCase().includes(needle) ||
        (t.description ?? '').toLowerCase().includes(needle) ||
        t.features.some((f) => f.toLowerCase().includes(needle)) ||
        (t.useCase ?? '').toLowerCase().includes(needle)
      )
    })
  }, [all, q, cat])

  const groups = useMemo(() => groupByCategory(filtered), [filtered])

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Production-ready starter kits — fork a template and deploy."
        actions={
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/templates" />
      ) : state.phase === 'loading' ? (
        <Text color="$color11">Loading…</Text>
      ) : all.length === 0 ? (
        <Text color="$color10">No templates available.</Text>
      ) : (
        <YStack gap="$3">
          <XStack gap="$2" items="center" flexWrap="wrap">
            <XStack items="center" gap="$2" bg="$color2" px="$3" rounded="$3" borderWidth={1} borderColor="$borderColor">
              <Search size={15} color="var(--color10)" />
              <Input
                unstyled
                placeholder="Search templates…"
                value={q}
                onChangeText={setQ}
                width={220}
                py="$2"
                fontSize="$3"
              />
              {q ? (
                <Button chromeless circular size="$1" icon={<X size={13} />} onPress={() => setQ('')} />
              ) : null}
            </XStack>
            <Button size="$2" chromeless={cat !== null} onPress={() => setCat(null)}>
              All
            </Button>
            {categories.map((c) => (
              <Button key={c} size="$2" chromeless={cat !== c} onPress={() => setCat(c)}>
                {c}
              </Button>
            ))}
          </XStack>

          {groups.length === 0 ? (
            <Text color="$color10">No templates match “{q}”.</Text>
          ) : (
            groups.map(([category, items]) => (
              <YStack key={category} gap="$2">
                <Text fontSize="$3" fontWeight="700" color="$color11">{category}</Text>
                <XStack gap="$3" flexWrap="wrap">
                  {items.map((t) => (
                    <TemplateCard key={t.slug} t={t} />
                  ))}
                </XStack>
              </YStack>
            ))
          )}
        </YStack>
      )}
    </>
  )
}

export function TemplatesModule(_props: { params: Record<string, string> }) {
  return <TemplatesView />
}
