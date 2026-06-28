import { test, expect, ACCOUNTS, baseline, trackConsoleErrors } from './fixtures'

/**
 * Every enabled in-console module must render its surface (PageHeader) cleanly
 * on a default (honest-empty) backend — no crash, no fabricated data, no console
 * error. This is the broad coverage net across the whole product surface.
 */
const ENABLED_MODULES: { path: string; title: string | RegExp }[] = [
  { path: '/models', title: 'Models' },
  { path: '/providers', title: 'Providers' },
  { path: '/embeddings', title: 'Stores' },
  { path: '/applications', title: 'Applications' },
  { path: '/vector', title: 'Hanzo Vector' },
  { path: '/sql', title: 'Hanzo SQL' },
  { path: '/kv', title: 'Hanzo KV' },
  { path: '/s3', title: 'Hanzo Object Storage' },
  { path: '/datastore', title: 'Hanzo Datastore' },
  { path: '/docdb', title: 'Hanzo DocDB' },
  { path: '/search', title: 'Hanzo Search' },
  { path: '/playground', title: 'Playground' },
  { path: '/o11y', title: 'Traces' },
  { path: '/sessions', title: 'Sessions' },
  { path: '/scores', title: 'Scores' },
  { path: '/evals', title: 'Evals' },
  { path: '/datasets', title: 'Datasets' },
  { path: '/prompts', title: 'Prompts' },
  { path: '/status', title: 'Status' },
  { path: '/plans', title: 'Plans & Pricing' },
  { path: '/wallet', title: /Wallet/ },
  { path: '/chat', title: 'Chat' },
  { path: '/bot', title: 'Bot' },
  { path: '/model-catalog', title: 'Model Catalog' },
  { path: '/api-keys', title: 'API Keys' },
  { path: '/settings', title: 'Settings' },
]

test.describe('module render smoke (enabled, non-admin)', () => {
  for (const m of ENABLED_MODULES) {
    test(`renders ${m.path} cleanly`, async ({ page, backend }) => {
      baseline(backend).account(ACCOUNTS.admin)
      const errors = trackConsoleErrors(page)
      await page.goto(m.path)
      await expect(page.getByTestId('page-content').getByText(m.title).first()).toBeVisible()
      expect(errors, `console errors on ${m.path}`).toEqual([])
    })
  }
})

test.describe('soon modules (honest coming-soon, never a 404)', () => {
  for (const id of ['agents', 'gpus', 'vpc', 'settlement']) {
    test(`/${id} shows an honest coming-soon page`, async ({ page, backend }) => {
      backend.account(ACCOUNTS.admin)
      await page.goto(`/${id}`)
      await expect(page.getByText(/is coming soon/)).toBeVisible()
      await expect(page.getByText('Request early access')).toBeVisible()
    })
  }
})

test.describe('data rendering', () => {
  test('Providers lists real rows from the backend', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).envelope(
      'get-providers',
      [
        { owner: 'hanzo', name: 'openai-prod', displayName: 'OpenAI Prod', category: 'Model', type: 'OpenAI', subType: 'gpt-4', state: 'Active' },
      ],
      1,
    )
    await page.goto('/providers')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('openai-prod')).toBeVisible()
    await expect(content.getByText('OpenAI Prod')).toBeVisible()
  })

  test('Plans renders priced plan cards from the rate card', async ({ page, backend }) => {
    baseline(backend).account(ACCOUNTS.admin).rest('pricing', {
      cloud: {
        plans: [
          { id: 'starter', name: 'Starter', category: 'Compute', description: 'Kick the tires.', cpuType: 'shared', vcpus: 1, memoryGB: 1, diskGB: 25, maxVMs: 1, priceMonthly: 5, freeTier: true },
          { id: 'pro', name: 'Pro', category: 'Compute', description: 'Production workloads.', cpuType: 'dedicated', vcpus: 4, memoryGB: 8, diskGB: 160, maxVMs: 10, priceMonthly: 48, popular: true },
        ],
      },
    })
    await page.goto('/plans')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Starter', { exact: true })).toBeVisible()
    await expect(content.getByText('Pro', { exact: true })).toBeVisible()
    await expect(content.getByText('$48')).toBeVisible()
  })
})

test.describe('honest async states', () => {
  test('observability traces show the runtime-initializing notice on 503', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).error('o11y/traces', 503)
    await page.goto('/o11y')
    await expect(page.getByText('Observability runtime initializing')).toBeVisible()
  })

  test('observability traces show "not routed" on 404', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).error('o11y/traces', 404)
    await page.goto('/o11y')
    await expect(page.getByText('Not routed on this host')).toBeVisible()
  })

  test('KMS reports "not routed" when /v1/kms 404s', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).error('kms/orgs/hanzo/secrets/', 404)
    await page.goto('/secrets')
    await expect(page.getByText('Not routed on this host')).toBeVisible()
  })
})
