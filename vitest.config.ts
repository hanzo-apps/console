import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Unit tests run in a plain Node env (no jsdom): every suite targets pure logic
 * or a `fetch`-mocked API call, so the browser globals a test needs (window,
 * localStorage) are stubbed explicitly per-suite. The `~` alias mirrors tsconfig.
 */
export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
