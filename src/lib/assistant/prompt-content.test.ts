import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_DOCS_STORE,
  buildAssistantPrompt,
  buildCommandBarPrompt,
  entryLine,
  entryOpensAt,
  overviewSection,
  behaviorSection,
  type PromptGroup,
} from './prompt-content'

/**
 * The prompt BUILDER is pure — these tests pin the grounded content + formatting
 * without importing the registry (the repo convention). The registry-bound wrapper
 * (`system-prompt.ts`) that feeds this the real 118-product catalog is thin and
 * proven by `next build` + live verification.
 */

// A representative catalog slice — mirrors real registry entries (ids, descriptions).
const GROUPS: PromptGroup[] = [
  {
    category: 'Compute',
    summary: 'Kubernetes, containers, functions, GPUs, machines, and tasks.',
    entries: [
      { id: 'gpus', label: 'GPUs', description: 'GPU clusters, utilization, and cost — on-demand H100/A100 compute.', opensAt: '/gpus' },
      { id: 'functions', label: 'Functions', description: 'Event-driven serverless functions.', opensAt: '/functions' },
    ],
  },
  {
    category: 'Data',
    summary: 'Vector, SQL, key-value, object, document, and memory stores.',
    entries: [
      { id: 'base', label: 'Base', description: 'A hosted backend for your app — collections, records, access rules and sign-in.', opensAt: '/base' },
      { id: 'vector', label: 'Vector', description: 'Managed vector database — embeddings & semantic search.', opensAt: '/vector' },
    ],
  },
]

describe('overviewSection', () => {
  it('carries the curated, accurate "what Hanzo is" facts (white-labeled by brand)', () => {
    const o = overviewSection('Hanzo Cloud')
    expect(o).toContain('# What Hanzo Cloud is')
    expect(o).toContain('is a full AI cloud')
    expect(o).toContain('Zen') // Hanzo's own model family
    expect(o).toContain('pay-as-you-go') // pricing model
    expect(o).toContain('hanzo.app') // app surface beyond the console
    expect(o).toContain('Marketplace')
    // White-labels: pass a different brand and it threads through.
    expect(overviewSection('Lux Cloud')).toContain('# What Lux Cloud is')
  })
})

describe('entryOpensAt', () => {
  it('opens a module in-console at /id and an external app at its URL', () => {
    expect(entryOpensAt({ kind: 'module', id: 'gpus' })).toBe('/gpus')
    expect(entryOpensAt({ kind: 'external', id: 'lux-explorer', href: 'https://explore.lux.network' })).toBe('https://explore.lux.network')
    // An external entry with no href still degrades to the in-console path (never blank).
    expect(entryOpensAt({ kind: 'external', id: 'x' })).toBe('/x')
  })
})

describe('entryLine', () => {
  it('renders label + NAV id token + description + deep-link (grounded, not invented)', () => {
    const line = entryLine({ id: 'gpus', label: 'GPUs', description: 'On-demand H100/A100.', opensAt: '/gpus' })
    expect(line).toBe('- GPUs [gpus] — On-demand H100/A100. · /gpus')
  })
})

describe('buildAssistantPrompt', () => {
  const prompt = buildAssistantPrompt('Hanzo Cloud', GROUPS)

  it('composes overview + generated catalog + behavior', () => {
    expect(prompt).toContain('# What Hanzo Cloud is')
    expect(prompt).toContain('# Product catalog')
    expect(prompt).toContain('# How to answer')
  })

  it('generates the catalog from the given groups — real ids, deep-links, category headers', () => {
    expect(prompt).toContain('## Compute — Kubernetes, containers, functions, GPUs, machines, and tasks.')
    expect(prompt).toContain('## Data — Vector, SQL, key-value, object, document, and memory stores.')
    for (const id of ['gpus', 'functions', 'base', 'vector']) {
      expect(prompt).toContain(`[${id}]`)
      expect(prompt).toContain(`/${id}`)
    }
    expect(prompt).toContain('There are 4 products') // count derives from the catalog
  })

  it('states the honest boundary — never invent, deep-link, defer to the live catalog', () => {
    expect(prompt).toContain('NEVER invent')
    expect(prompt).toContain("doesn't have")
    expect(prompt).toContain('/models')
    expect(prompt).toContain('/plans')
    expect(prompt).toContain('Default to a Zen model')
  })

  it('leaks no secret, token, or KMS path', () => {
    expect(prompt).not.toMatch(/kms:\/\//)
    expect(prompt).not.toMatch(/Bearer\s+[A-Za-z0-9]/)
    expect(prompt).not.toMatch(/SERVICE_TOKEN|CLIENT_SECRET|sk-[a-f0-9]/)
  })

  it('faithfully includes only the products it is given (gating is the caller\'s job)', () => {
    // finance/business are admin-only in the real registry; not in these groups → absent.
    expect(prompt).not.toContain('[finance]')
    const withAdmin = buildAssistantPrompt('Hanzo Cloud', [
      ...GROUPS,
      { category: 'Observe', entries: [{ id: 'finance', label: 'Finance', description: 'Burn-down, revenue, runway.', opensAt: '/finance' }] },
    ])
    expect(withAdmin).toContain('[finance]')
  })
})

describe('buildCommandBarPrompt', () => {
  it('is the shared prompt PLUS the NAV contract (DRY — one catalog)', () => {
    const base = buildAssistantPrompt('Hanzo Cloud', GROUPS)
    const cmd = buildCommandBarPrompt('Hanzo Cloud', GROUPS)
    expect(cmd.startsWith(base)).toBe(true)
    expect(cmd).toContain('# Command bar')
    expect(cmd).toContain('NAV <id>')
    expect(base).not.toContain('# Command bar') // the base carries no nav directive
  })
})

describe('behaviorSection + ASSISTANT_DOCS_STORE', () => {
  it('names the honest boundary and the shared docs store', () => {
    expect(behaviorSection('Hanzo Cloud')).toContain('NEVER invent')
    expect(ASSISTANT_DOCS_STORE).toBe('docs')
  })
})
