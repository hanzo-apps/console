import { test, expect, ACCOUNTS } from './fixtures'

/**
 * Forms — real input, real validation, real success. The managed-resource create
 * form shares one slug rule with every create surface; the provider Add flow
 * mints a record and opens its editor.
 */
test.describe('managed resource create (Vector)', () => {
  test('rejects an invalid name with honest inline guidance', async ({ page, backend }) => {
    backend.account(ACCOUNTS.admin).rest('vector', [])
    await page.goto('/vector')
    const content = page.getByTestId('page-content')
    await expect(content.getByText('Hanzo Vector', { exact: true })).toBeVisible()
    await page.getByPlaceholder('my-resource').fill('Bad_Name')
    await expect(
      content.getByText(/Lowercase letters, numbers, hyphens; start with a letter, end alphanumeric/),
    ).toBeVisible()
  })

  test('creates a resource and reveals one-time credentials', async ({ page, backend }) => {
    backend
      .account(ACCOUNTS.admin)
      .rest('vector', [])
      .createdAt('POST', 'vector', {
        id: 'v-1',
        name: 'my-index',
        kind: 'vector',
        status: 'creating',
        host: 'vec.hanzo.internal',
        port: 6333,
        connectionString: 'https://vec.hanzo.internal:6333?key=onetime',
        password: 'one-time-secret',
      })
    await page.goto('/vector')
    const content = page.getByTestId('page-content')
    await page.getByPlaceholder('my-resource').fill('my-index')
    await content.getByText('Create', { exact: true }).click()
    await expect(content.getByText(/my-index created — save your credentials now/)).toBeVisible()
    await expect(content.getByText('Connection string', { exact: true })).toBeVisible()
  })
})

test.describe('provider add', () => {
  test('Add mints a provider and opens its editor', async ({ page, backend }) => {
    backend
      .account(ACCOUNTS.admin)
      .envelope('get-providers', [], 0)
      .envelope('add-provider', 'ok')
      .envelope('get-provider', {
        owner: 'admin',
        name: 'provider_new',
        displayName: 'New Provider',
        category: 'Model',
        type: 'OpenAI',
        subType: 'gpt-4',
        state: 'Active',
      })
    await page.goto('/providers')
    const content = page.getByTestId('page-content')
    await content.getByText('Add', { exact: true }).click()
    await page.waitForURL(/\/providers\/provider_/)
    // The editor rendered real inputs (we navigated off the list).
    await expect(content.locator('input').first()).toBeVisible()
  })
})
