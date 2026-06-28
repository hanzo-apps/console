import { test, expect, ACCOUNTS, baseline, trackConsoleErrors } from './fixtures'

/**
 * Admin surfaces — Identity & Access (orgs/users/roles), Audit, Secrets (KMS),
 * Clusters, Kubernetes, Settings, and API Keys. These are the highest-bar pages:
 * real tabbed navigation, real CRUD-shaped reads, and honest states — all driven
 * by an admin session. Every read is mocked, so nothing touches real prod data.
 */
test.describe('IAM (Identity & Access)', () => {
  const ORGS = [
    { owner: 'admin', name: 'hanzo', displayName: 'Hanzo', websiteUrl: 'https://hanzo.ai', createdTime: '2026-01-02T00:00:00Z' },
  ]
  const USERS = [
    { owner: 'hanzo', name: 'ada-admin', displayName: 'Ada Admin', email: 'ada@example.test', isAdmin: true, type: 'normal-user' },
    { owner: 'hanzo', name: 'mo-member', displayName: 'Mo Member', email: 'mo@example.test', isAdmin: false, type: 'normal-user' },
  ]
  const ROLES = [
    { owner: 'hanzo', name: 'cloud-admins', displayName: 'Cloud Admins', isEnabled: true, users: ['hanzo/ada-admin'] },
  ]

  test('organizations tab lists orgs and exposes the tab bar', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).envelope('iam/get-organizations', ORGS, 1)
    await page.goto('/iam')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Identity & Access')).toBeVisible()
    await expect(content.getByText('Hanzo', { exact: true })).toBeVisible()
    for (const tab of ['Organizations', 'Users', 'Roles']) {
      await expect(content.getByText(tab, { exact: true })).toBeVisible()
    }
  })

  test('users tab lists users with admin/member role badges', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).envelope('iam/get-organizations', ORGS, 1).envelope('iam/get-users', USERS, 2)
    await page.goto('/iam')
    await page.getByTestId('page-content').getByText('Users', { exact: true }).click()
    await page.waitForURL('**/iam/users')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Ada Admin')).toBeVisible()
    await expect(content.getByText('Mo Member')).toBeVisible()
    await expect(content.getByText('admin', { exact: true })).toBeVisible()
  })

  test('roles tab lists roles', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).envelope('iam/get-roles', ROLES, 1)
    await page.goto('/iam/roles')
    await expect(page.getByTestId('page-content').getByText('cloud-admins')).toBeVisible()
  })

  test('shows an honest "needs admin" state on 403', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).error('iam/get-organizations', 403)
    await page.goto('/iam')
    await expect(page.getByText('Access required')).toBeVisible()
    await expect(page.getByText(/requires an admin session/)).toBeVisible()
  })

  test('shows an honest "not routed" state on 404', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).error('iam/get-organizations', 404)
    await page.goto('/iam')
    await expect(page.getByText(/The IAM admin API .* is not routed/)).toBeVisible()
  })
})

test.describe('Audit', () => {
  test('lists identity & access events', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).envelope(
      'iam/get-records',
      [{ id: 1, createdTime: '2026-06-20T10:00:00Z', user: 'ada-admin', action: 'login', method: 'POST', requestUri: '/v1/signin', clientIp: '203.0.113.7' }],
      1,
    )
    await page.goto('/audit')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Audit')).toBeVisible()
    await expect(content.getByText('ada-admin')).toBeVisible()
    await expect(content.getByText('203.0.113.7')).toBeVisible()
  })
})

test.describe('Secrets (KMS)', () => {
  test('states the zero-knowledge model and probes reachability', async ({ page, backend }) => {
    const errors = trackConsoleErrors(page)
    backend.account(ACCOUNTS.admin) // default 200 -> reachable
    await page.goto('/secrets')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Zero-knowledge by design')).toBeVisible()
    await expect(content.getByText('KMS reachable')).toBeVisible()
    await expect(content.getByText('KMS console').first()).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('Clusters', () => {
  test('renders the dedicated-cluster surface with an honest empty state', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).paas('org/hanzo/cluster', { clusters: [] })
    await page.goto('/clusters')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Clusters')).toBeVisible()
    await expect(content.getByText(/No dedicated clusters yet/)).toBeVisible()
  })
})

test.describe('Kubernetes', () => {
  test('renders the workloads surface with an honest empty state', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).paas('apps', { apps: [] })
    await page.goto('/kubernetes')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Kubernetes')).toBeVisible()
    await expect(content.getByText(/No workloads/)).toBeVisible()
  })
})

test.describe('Settings', () => {
  test('General tab shows the real signed-in account', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin)
    await page.goto('/settings')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Settings')).toBeVisible()
    await expect(content.getByText('ada@example.test')).toBeVisible()
  })

  test('Branding tab shows the resolved per-host runtime config', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin)
    await page.goto('/settings')
    await page.getByTestId('page-content').getByText('Branding', { exact: true }).click()
    await page.waitForURL('**/settings/branding')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('https://hanzo.id')).toBeVisible()
    await expect(content.getByText('Hanzo Cloud', { exact: true })).toBeVisible()
  })

  test('Members tab lists organization members', async ({ page, backend }) => {
    backend
      .account(ACCOUNTS.admin)
      .envelope('iam/get-users', [{ owner: 'hanzo', name: 'mo-member', displayName: 'Mo Member', email: 'mo@example.test', isAdmin: false, type: 'normal-user' }], 1)
    await page.goto('/settings/members')
    await expect(page.getByTestId('page-content').getByText('Mo Member')).toBeVisible()
  })
})

test.describe('API Keys', () => {
  test('explains where keys live when the account exposes none', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin) // no accessKey/accessSecret
    await page.goto('/api-keys')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('No API key on this account')).toBeVisible()
    await expect(content.getByText('API docs')).toBeVisible()
  })

  test('masks the credential by default and reveals it on click', async ({ page, backend }) => {
    backend.account({ ...ACCOUNTS.admin, accessKey: 'hk-abc123def456ghi', accessSecret: 'sk-topsecretvalue99' })
    await page.goto('/api-keys')
    const content = page.getByTestId('page-content')
    // Masked: the full secret is NOT visible initially.
    await expect(content.getByText('hk-abc123def456ghi')).toHaveCount(0)
    await content.getByText('Reveal').first().click()
    await expect(content.getByText('hk-abc123def456ghi')).toBeVisible()
  })
})
