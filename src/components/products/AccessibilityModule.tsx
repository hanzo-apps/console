'use client'

/**
 * Accessibility — a Wix-style WCAG checker for the site you are building. It runs
 * Deque's axe-core against the CURRENT page, entirely in the browser: nothing is
 * sent to a server, no page content leaves the tab. The engine is loaded on demand
 * (`import('axe-core')` → its own chunk), so it never weighs down the main bundle;
 * a scan is user-triggered (never on every render) and asks axe for violations only
 * (`resultTypes: ['violations']`) to keep it fast on large DOMs.
 *
 * All processing is the pure, unit-tested `~/lib/a11y/scan` (sort/summarize/WCAG
 * labels) — this file is only the panel: a Scan button, per-severity count cards,
 * and an honest table (idle → scanning → results/empty, or a plain error card).
 */
import { useCallback, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Accessibility, ExternalLink } from '@hanzogui/lucide-icons-2'

import { toIssues, summarize, IMPACTS, type A11yIssue, type A11ySummary, type Impact } from '~/lib/a11y/scan'
import { DataTable, PageHeader, type Column } from '@hanzo/ui/product'

type State =
  | { phase: 'idle' }
  | { phase: 'scanning' }
  | { phase: 'done'; issues: A11yIssue[]; summary: A11ySummary }
  | { phase: 'error'; message: string }

const IMPACT_COLOR = {
  critical: '$red10',
  serious: '$yellow10',
  moderate: '$yellow10',
  minor: '$color11',
} as const satisfies Record<Impact, string>
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The one axe-core entrypoint we use — declared locally so the dynamic import interop stays typed. */
type AxeModule = { run: (ctx: Document, opts?: { resultTypes?: string[] }) => Promise<{ violations: unknown[] }> }

export function AccessibilityModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'idle' })

  const scan = useCallback(async () => {
    if (typeof document === 'undefined') return
    setState({ phase: 'scanning' })
    try {
      const mod = (await import('axe-core')) as unknown as { default?: AxeModule } & Partial<AxeModule>
      const axe = mod.default ?? (mod as AxeModule)
      if (typeof axe.run !== 'function') throw new Error('The accessibility scanner did not load, so nothing was scanned. Reload the page and scan again.')
      const { violations } = await axe.run(document, { resultTypes: ['violations'] })
      const issues = toIssues(violations)
      setState({ phase: 'done', issues, summary: summarize(issues) })
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  const columns: Column<A11yIssue>[] = [
    {
      key: 'impact',
      header: 'Impact',
      width: 100,
      render: (r) => (
        <Text fontSize="$3" fontWeight="700" color={IMPACT_COLOR[r.impact]}>
          {cap(r.impact)}
        </Text>
      ),
    },
    {
      key: 'help',
      header: 'Issue',
      render: (r) => (
        <YStack>
          <Text fontSize="$3" fontWeight="600">{r.help}</Text>
          <Text fontSize="$1" color="$color10">{r.id}</Text>
        </YStack>
      ),
    },
    { key: 'wcag', header: 'WCAG', width: 160, render: (r) => <Text fontSize="$2" color="$color11">{r.wcag.join(' · ') || '—'}</Text> },
    { key: 'nodes', header: 'Elements', width: 90, render: (r) => <Text fontSize="$3" color="$color11">{r.nodes}</Text> },
    { key: 'target', header: 'First match', render: (r) => <Text fontSize="$2" color="$color10">{r.target || '—'}</Text> },
    {
      key: 'learn',
      header: '',
      width: 56,
      render: (r) =>
        r.helpUrl ? (
          <Button
            size="$2"
            chromeless
            aria-label={`How to fix: ${r.help}`}
            icon={<ExternalLink size={14} />}
            onPress={() => {
              if (typeof window !== 'undefined') window.open(r.helpUrl, '_blank', 'noopener,noreferrer')
            }}
          />
        ) : null,
    },
  ]

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="Accessibility"
        subtitle="Scan the current page for WCAG issues — axe-core runs in your browser, nothing leaves the page."
        actions={
          <Button
            size="$3"
            theme="light"
            icon={<Accessibility size={15} />}
            disabled={state.phase === 'scanning'}
            onPress={() => void scan()}
          >
            {state.phase === 'scanning' ? 'Scanning…' : 'Scan this page'}
          </Button>
        }
      />

      {state.phase === 'idle' ? (
        <Card p="$4" borderWidth={1} borderColor="$borderColor">
          <Text color="$color11">
            Run a scan to check this page against the WCAG 2 A/AA rule set. The engine loads on demand and runs entirely
            in your browser — no page content is sent anywhere.
          </Text>
        </Card>
      ) : null}

      {state.phase === 'error' ? (
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
          <Text color="$red10" fontWeight="600">Scan failed</Text>
          <Text fontSize="$2" color="$color11">{state.message}</Text>
        </Card>
      ) : null}

      {state.phase === 'done' ? (
        <>
          <XStack gap="$3" flexWrap="wrap">
            {IMPACTS.map((imp) => (
              <Card key={imp} p="$3" minWidth={150} borderWidth={1} borderColor="$borderColor">
                <Text fontSize="$2" color="$color10">{cap(imp)}</Text>
                <Text fontSize="$7" fontWeight="800" color={IMPACT_COLOR[imp]}>{state.summary.byImpact[imp]}</Text>
              </Card>
            ))}
          </XStack>
          <DataTable
            columns={columns}
            rows={state.issues}
            rowKey={(r) => r.id}
            empty="No accessibility violations found on this page. Nice work."
          />
        </>
      ) : null}
    </YStack>
  )
}
