'use client'

/**
 * Command palette — ONE command surface for the whole console (⌘K / Ctrl+K).
 *
 * It is one widget with modes, not four. The query string selects the mode:
 *   - default     fuzzy-filters the product catalog; ↵ jumps to the product
 *                 (in-console route or external tab) — instant across every product.
 *   - `>` prefix  asks the AI (one cloud `/v1` backend) to find a product or
 *                 answer; a clear product match becomes a "Go to …" jump.
 *   - `?` prefix  asks the docs knowledge store (RAG, store=`docs`) and shows the
 *                 grounded answer with any links it cites.
 *
 * Everything composes existing pieces: the catalog registry (`searchCatalog` +
 * `openProduct`), the AI client (`AiApi`), and the honest backend-state mapper.
 * Nothing is fabricated — AI/RAG failures degrade to a truthful state card.
 *
 * Keyboard is handled on `window`: ⌘K toggles from anywhere; while open, ↑/↓ move
 * the selection, ↵ activates, Esc closes. The header search box opens it; the
 * shell's "?" opens it straight in docs-help mode.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  Anchor,
  Dialog,
  Input,
  ScrollView,
  Spinner,
  Text,
  VisuallyHidden,
  XStack,
  YStack,
} from '@hanzo/gui'
import {
  ArrowRight,
  Command,
  CornerDownLeft,
  ExternalLink,
  LayoutGrid,
  Lock,
  Search,
  Sparkles,
} from '@hanzogui/lucide-icons-2'

import { AiApi } from '~/lib/api'
import { catalog, findEntry, type CatalogEntry } from '~/lib/products/registry'
import { searchCatalog } from '~/lib/products/search'
import { openProduct } from '~/lib/products/open'
import { useAppLauncher } from '~/components/AppLauncher'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

type Mode = 'catalog' | 'ai' | 'help'

type PaletteApi = {
  isOpen: boolean
  open: () => void
  openMode: (mode: 'ai' | 'help') => void
  close: () => void
}

const Ctx = createContext<PaletteApi | null>(null)

export function useCommandPalette(): PaletteApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCommandPalette must be used within <CommandPaletteProvider>')
  return ctx
}

/** System prompt for `>` mode: lets the model map a request to ONE product id. */
function navSystemPrompt(): string {
  const list = catalog.map((e) => `${e.id} — ${e.label} — ${e.category}`).join('\n')
  return [
    'You are the command bar for the Hanzo Cloud Console.',
    'The user wants to find or open a product, or asks a question.',
    'Products (id — label — category):',
    list,
    '',
    'If the request clearly refers to ONE product above, reply with exactly: NAV <id>',
    'using an id from the list and nothing else. Otherwise answer concisely in plain text.',
  ].join('\n')
}

type RunState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'nav'; entry: CatalogEntry }
  | { status: 'text'; text: string }
  | { status: 'error'; state: BackendState }

/** Render an answer as lines, then surface any URLs it cites as real links. */
function Answer({ text }: { text: string }) {
  const urls = Array.from(new Set(text.match(/https?:\/\/[^\s)]+/g) ?? []))
  return (
    <YStack gap="$2.5">
      <YStack>
        {text.split('\n').map((line, i) => (
          <Text key={i} fontSize="$3" color="$color12">
            {line === '' ? ' ' : line}
          </Text>
        ))}
      </YStack>
      {urls.length > 0 ? (
        <YStack gap="$1" borderTopWidth={1} borderColor="$borderColor" pt="$2">
          <Text fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
            Links
          </Text>
          {urls.map((u) => (
            <Anchor key={u} href={u} target="_blank" fontSize="$2" color="$color12" textDecorationLine="underline">
              {u}
            </Anchor>
          ))}
        </YStack>
      ) : null}
    </YStack>
  )
}

function CatalogRow({
  entry,
  active,
  onPress,
}: {
  entry: CatalogEntry
  active: boolean
  onPress: () => void
}) {
  const Icon = entry.icon
  return (
    <XStack
      onPress={onPress}
      cursor="pointer"
      items="center"
      gap="$3"
      px="$3"
      py="$2.5"
      rounded="$3"
      bg={active ? '$color5' : 'transparent'}
      hoverStyle={{ bg: active ? '$color5' : '$color3' }}
    >
      <Icon size={17} />
      <YStack flex={1}>
        <Text fontSize="$3" fontWeight="600" color="$color12">
          {entry.label}
        </Text>
        <Text fontSize="$1" color="$color10">
          {entry.category}
          {entry.gcp ? ` · ${entry.gcp}` : ''}
        </Text>
      </YStack>
      {entry.admin ? <Lock size={13} opacity={0.45} /> : null}
      {entry.kind === 'external' ? <ExternalLink size={13} opacity={0.45} /> : <ArrowRight size={13} opacity={active ? 0.8 : 0.3} />}
    </XStack>
  )
}

function PaletteDialog({
  open,
  seed,
  onOpenChange,
}: {
  open: boolean
  seed: string
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const launcher = useAppLauncher()
  const [query, setQuery] = useState(seed)
  const [sel, setSel] = useState(0)
  const [run, setRun] = useState<RunState>({ status: 'idle' })

  const mode: Mode = query.startsWith('>') ? 'ai' : query.startsWith('?') ? 'help' : 'catalog'
  const sub = (mode === 'catalog' ? query : query.slice(1)).trim()

  const results = useMemo(
    () => (mode === 'catalog' ? searchCatalog(query).slice(0, 50) : []),
    [mode, query],
  )

  // Seed the query each time the palette opens.
  useEffect(() => {
    if (open) setQuery(seed)
  }, [open, seed])

  // A new query resets selection + any prior AI run.
  useEffect(() => {
    setSel(0)
    setRun({ status: 'idle' })
  }, [query])

  const activate = useCallback(
    (entry: CatalogEntry) => {
      onOpenChange(false)
      openProduct(entry, (p) => router.push(p))
    },
    [onOpenChange, router],
  )

  const submit = useCallback(async () => {
    if (!sub) return
    setRun({ status: 'loading' })
    try {
      if (mode === 'ai') {
        const ans = (await AiApi.chat({ question: sub, system: navSystemPrompt() })).trim()
        const m = ans.match(/^NAV\s+([a-z0-9-]+)/i)
        const entry = m ? findEntry(m[1]) : undefined
        if (entry) setRun({ status: 'nav', entry })
        else setRun({ status: 'text', text: ans })
      } else {
        const ans = await AiApi.ragChat({ question: sub, store: 'docs' })
        setRun({ status: 'text', text: ans })
      }
    } catch (e) {
      setRun({ status: 'error', state: classifyBackend(e) })
    }
  }, [mode, sub])

  // Keyboard while open: ↑/↓ select, ↵ activate/ask, Esc close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false)
        return
      }
      if (mode === 'catalog') {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSel((s) => Math.min(s + 1, Math.max(results.length - 1, 0)))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSel((s) => Math.max(s - 1, 0))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const r = results[sel]
          if (r) activate(r)
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (run.status === 'loading') return
        if (run.status === 'nav') activate(run.entry)
        else void submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, mode, results, sel, run, submit, activate, onOpenChange])

  const placeholder =
    mode === 'ai'
      ? 'Ask AI to find or do something…'
      : mode === 'help'
        ? 'Ask the docs…'
        : 'Search products, or type > for AI, ? for docs'

  return (
    <Dialog modal open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay key="palette-overlay" bg="rgba(0,0,0,0.5)" />
        <Dialog.Content
          key="palette-content"
          bordered
          elevate
          width={640}
          maxW="90%"
          p="$0"
          gap="$0"
          overflow="hidden"
        >
          <VisuallyHidden>
            <Dialog.Title>Command palette</Dialog.Title>
          </VisuallyHidden>

          {/* Query row */}
          <XStack items="center" gap="$2.5" px="$3.5" py="$3" borderBottomWidth={1} borderColor="$borderColor">
            {mode === 'ai' ? (
              <Sparkles size={18} opacity={0.7} />
            ) : (
              <Search size={18} opacity={0.7} />
            )}
            <Input
              flex={1}
              unstyled
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={placeholder}
              fontSize="$4"
              color="$color12"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <XStack items="center" gap="$1" opacity={0.5}>
              <Text fontSize="$1" color="$color10">
                esc
              </Text>
            </XStack>
          </XStack>

          {/* Body */}
          <YStack minH={120} maxH={420}>
            {mode === 'catalog' ? (
              results.length === 0 ? (
                <YStack p="$5" items="center">
                  <Text color="$color10">No products match “{sub}”.</Text>
                </YStack>
              ) : (
                <ScrollView p="$2">
                  <YStack gap="$0.5">
                    {results.map((entry, i) => (
                      <CatalogRow key={entry.id} entry={entry} active={i === sel} onPress={() => activate(entry)} />
                    ))}
                  </YStack>
                </ScrollView>
              )
            ) : (
              <YStack p="$4" gap="$3">
                {run.status === 'idle' ? (
                  <XStack gap="$2" items="center">
                    <CornerDownLeft size={15} opacity={0.6} />
                    <Text color="$color10" fontSize="$3">
                      {mode === 'ai'
                        ? 'Press ↵ to ask AI to find a product or answer.'
                        : 'Press ↵ to search the docs.'}
                    </Text>
                  </XStack>
                ) : run.status === 'loading' ? (
                  <XStack gap="$2.5" items="center">
                    <Spinner color="$color11" />
                    <Text color="$color11" fontSize="$3">
                      {mode === 'ai' ? 'Thinking…' : 'Searching the docs…'}
                    </Text>
                  </XStack>
                ) : run.status === 'nav' ? (
                  <CatalogRow entry={run.entry} active onPress={() => activate(run.entry)} />
                ) : run.status === 'text' ? (
                  <Answer text={run.text} />
                ) : (
                  <BackendStateCard state={run.state} onRetry={() => void submit()} />
                )}
              </YStack>
            )}
          </YStack>

          {/* Legend */}
          <XStack
            px="$3.5"
            py="$2"
            gap="$3"
            borderTopWidth={1}
            borderColor="$borderColor"
            bg="$color1"
            flexWrap="wrap"
          >
            <Legend keys="↑↓" label="navigate" />
            <Legend keys="↵" label="open" />
            <Legend keys=">" label="AI" />
            <Legend keys="?" label="docs" />
            <XStack flex={1} />
            <XStack
              onPress={() => {
                onOpenChange(false)
                launcher.open()
              }}
              cursor="pointer"
              items="center"
              gap="$1.5"
              opacity={0.8}
              hoverStyle={{ opacity: 1 }}
            >
              <LayoutGrid size={13} />
              <Text fontSize="$1" color="$color11" fontWeight="600">
                Browse all apps
              </Text>
            </XStack>
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function Legend({ keys, label }: { keys: string; label: string }) {
  return (
    <XStack items="center" gap="$1.5" opacity={0.6}>
      <Text fontSize="$1" color="$color12" fontWeight="700">
        {keys}
      </Text>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
    </XStack>
  )
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [seed, setSeed] = useState('')

  const open = useCallback(() => {
    setSeed('')
    setIsOpen(true)
  }, [])

  const openMode = useCallback((mode: 'ai' | 'help') => {
    setSeed(mode === 'ai' ? '> ' : '? ')
    setIsOpen(true)
  }, [])

  const close = useCallback(() => setIsOpen(false), [])

  // ⌘K / Ctrl+K toggles the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setSeed('')
        setIsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Ctx.Provider value={{ isOpen, open, openMode, close }}>
      {children}
      <PaletteDialog open={isOpen} seed={seed} onOpenChange={setIsOpen} />
    </Ctx.Provider>
  )
}

/** Header trigger — a search box that opens the palette. */
export function CommandSearchBox() {
  const { open } = useCommandPalette()
  return (
    <XStack
      onPress={open}
      cursor="pointer"
      items="center"
      gap="$2"
      px="$3"
      height={36}
      flex={1}
      maxW={420}
      bg="$color2"
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$4"
      hoverStyle={{ borderColor: '$color8' }}
    >
      <Search size={15} opacity={0.6} />
      <Text flex={1} fontSize="$3" color="$color10" numberOfLines={1}>
        Search or jump to…
      </Text>
      <XStack items="center" gap="$1" opacity={0.6}>
        <Command size={12} />
        <Text fontSize="$2" color="$color10">
          K
        </Text>
      </XStack>
    </XStack>
  )
}
