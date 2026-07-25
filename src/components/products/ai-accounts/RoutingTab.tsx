'use client'

/**
 * AI Accounts — Smart routing. The core value prop: `model: "auto"` routes each
 * request to the best/cheapest capable model (local zen → cheap tier → frontier)
 * and is billed as whatever actually served it (the `X-Routed-Model` response
 * header), for up to 90% lower spend (workload-dependent).
 *
 * The toggle persists the org/user `routingEnabled` preference server-side via the
 * sealed-cookie settings store (`/v1/ai-accounts/settings`), following the SAME
 * pattern as the credential store. It is HONEST about scope: it sets the org
 * preference that Hanzo surfaces (chat/app/desktop/mobile) read; API callers opt in
 * per request with `model: "auto"` (a copyable curl is shown).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Route, Check, Copy, BookOpen, Newspaper, Sparkles } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { AiAccountsApi } from '~/lib/api/ai-accounts'
import { resolveRouting, type OrgRoutingDefaults } from '~/lib/products/ai-accounts'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { FieldSwitch } from '~/components/ui/Field'
import { Loader } from '~/components/ui/Loader'
import { useToast } from '~/components/ui/Toast'
import { toneColor } from '~/components/ui/tone'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

/** The docs page + the marketing blog post (blog host = docs host minus the `docs.` label). */
const ROUTING_DOCS = `${config.docsUrl}/docs/usage/routing`
const ROUTING_BLOG = `${config.docsUrl.replace('docs.', '')}/blog/smart-routing`

const CURL = `curl ${config.cloudUrl}/v1/chat/completions \\
  -H "Authorization: Bearer $HANZO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'`

/** A read-only monospace code block with a copy button (matches the Authors idiom). */
function CodeBlock({ code }: { code: string }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(code)
    setCopied(true)
    toast.success('Copied')
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <XStack gap="$2" items="flex-start" flexWrap="wrap">
      <Card flex={1} minW={240} px="$3" py="$2.5" bg="$color2" borderWidth={1} borderColor="$borderColor" rounded="$3">
        <Text style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }} fontSize="$2" color="$color12">
          {code}
        </Text>
      </Card>
      <Button size="$3" icon={copied ? <Check size={15} /> : <Copy size={15} />} onPress={copy}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </XStack>
  )
}

/** What the tab renders once loaded: the user's tri-state cookie override + the
 *  server-driven org defaults (null when the defaults endpoint was unreachable). */
type Routing = { pref: boolean | null; org: OrgRoutingDefaults | null }

export function AIAccountsRouting(_props: { params: Record<string, string> }) {
  const toast = useToast()
  const [state, setState] = useState<Async<Routing>>({ phase: 'loading' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    // The cookie preference is the required read; the org defaults are fail-soft
    // (routingDefaults never throws — it resolves null on an older cloud-api / error),
    // so an unreachable defaults endpoint degrades to the preference alone, not an error.
    Promise.all([AiAccountsApi.settings(), AiAccountsApi.routingDefaults()])
      .then(([s, org]) => setState({ phase: 'ready', data: { pref: s.settings.routingEnabled, org } }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (next: boolean) => {
    setBusy(true)
    try {
      const r = await AiAccountsApi.saveSettings({ routingEnabled: next })
      setState((prev) =>
        prev.phase === 'ready'
          ? { phase: 'ready', data: { ...prev.data, pref: r.settings.routingEnabled } }
          : prev,
      )
      toast.success(next ? 'Smart routing enabled' : 'Smart routing disabled')
    } catch (e) {
      toast.error('Could not save preference', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const resolved =
    state.phase === 'ready' ? resolveRouting(state.data.pref, state.data.org) : { enabled: false, toggleDisabled: false, orgDefault: null }
  const { enabled, toggleDisabled, orgDefault } = resolved

  return (
    <>
      <PageHeader
        title="Smart routing"
        subtitle="Route each request to the best, cheapest capable model — for up to 90% lower spend."
      />

      {state.phase === 'loading' ? (
        <Loader label="Loading preference…" />
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} />
      ) : (
        <YStack gap="$4">
          {/* The value-prop card + enable toggle */}
          <Card p="$4" gap="$4" borderWidth={1} borderColor="$borderColor" bg="$color2">
            <XStack items="flex-start" gap="$3" justify="space-between" flexWrap="wrap">
              <XStack items="center" gap="$2" flex={1} minW={0}>
                <Route size={18} color="#D4D4D4" />
                <Text fontSize="$6" fontWeight="700">
                  Smart routing
                </Text>
              </XStack>
              <XStack items="center" gap="$2">
                <Text fontSize="$2" color="$color11">
                  {toggleDisabled ? 'Disabled for your organization' : enabled ? 'Enabled' : 'Disabled'}
                </Text>
                <FieldSwitch checked={enabled} onChange={toggle} disabled={busy || toggleDisabled} />
              </XStack>
            </XStack>

            {/* The org-level default an admin set — honest about where the default comes
                from. Shown only when the defaults endpoint answered; on an older cloud-api
                (org === null → orgDefault null, not disabled) this line is simply absent. */}
            {toggleDisabled ? (
              <Text fontSize="$2" color="$color10">
                Smart routing is turned off for your organization by your admin.
              </Text>
            ) : orgDefault !== null ? (
              <Text fontSize="$2" color="$color10">
                Organization default: {orgDefault ? 'On' : 'Off'} — set by your admin. Your choice here
                overrides it for you.
              </Text>
            ) : null}

            <Text fontSize="$3" color="$color11" maxW={720}>
              With <Text style={{ fontFamily: 'monospace' }}>model: &quot;auto&quot;</Text>, each request is routed to the
              best, cheapest capable model — local zen first, then a cheap tier, then a frontier model only when the
              workload needs it. You are billed as whatever actually served the request, reported in the{' '}
              <Text style={{ fontFamily: 'monospace' }}>X-Routed-Model</Text> response header.
            </Text>

            <XStack items="center" gap="$2">
              <Sparkles size={15} color={toneColor('positive')} />
              <Text fontSize="$3" fontWeight="600" color="$color12">
                Up to 90% lower spend — workload-dependent.
              </Text>
            </XStack>

            <XStack gap="$2" flexWrap="wrap">
              <Button size="$2" icon={<BookOpen size={15} />} onPress={() => window.open(ROUTING_DOCS, '_blank', 'noopener')}>
                Routing docs
              </Button>
              <Button size="$2" icon={<Newspaper size={15} />} onPress={() => window.open(ROUTING_BLOG, '_blank', 'noopener')}>
                Read the blog post
              </Button>
            </XStack>

            <Text fontSize="$1" color="$color10" maxW={720}>
              This is a preference — it applies to Hanzo surfaces (chat, app, desktop, mobile) that read your org default.
              API callers opt in per request with <Text style={{ fontFamily: 'monospace' }}>model: &quot;auto&quot;</Text>.
            </Text>
          </Card>

          {/* Copyable curl for API users */}
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$4" fontWeight="700">
              Use it from the API
            </Text>
            <Text fontSize="$2" color="$color11" maxW={720}>
              Send <Text style={{ fontFamily: 'monospace' }}>&quot;model&quot;: &quot;auto&quot;</Text> on any chat
              completion — no per-model bookkeeping. The response header{' '}
              <Text style={{ fontFamily: 'monospace' }}>X-Routed-Model</Text> tells you what served it.
            </Text>
            <CodeBlock code={CURL} />
          </Card>
        </YStack>
      )}
    </>
  )
}
