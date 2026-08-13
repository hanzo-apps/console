import { test, expect } from '@playwright/test'

/**
 * Every docs URL this app hands a reader must RESOLVE. Four were shipped as 404s
 * because a product name was assumed to imply a page; this asserts against the live
 * docs site so the next assumption fails here instead of in front of a customer.
 */
const LIVE = ['', 'docs/api', 'docs/models', 'docs/pricing', 'docs/gateway', 'docs/agents']

for (const path of LIVE) {
  test(`docs.hanzo.ai/${path} resolves`, async ({ request }) => {
    const res = await request.get(`https://docs.hanzo.ai/${path}`)
    expect(res.status(), `${path} is a dead link`).toBeLessThan(400)
  })
}
