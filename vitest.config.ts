import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * Unit-test runner config for console2.
 *
 * Scope: PURE client logic + data-integrity (routing, registry/catalog, config,
 * the /v1 client envelope, domain `logic.ts` files). Real rendering and user
 * interaction are covered by Playwright (test/e2e) against the live Next server,
 * so the heavy GUI deps are aliased to hermetic no-op stubs: the registry module
 * graph imports cleanly without pulling Tamagui/react-native into Node.
 */
const stub = (file: string) => resolve(__dirname, 'test/stubs', file)

export default defineConfig({
  resolve: {
    alias: [
      // App path alias (`~/x` -> `src/x`), mirrors tsconfig paths.
      { find: /^~\//, replacement: resolve(__dirname, 'src') + '/' },
      // Heavy UI deps -> hermetic stubs (imported, never rendered in unit tests).
      { find: '@hanzo/gui', replacement: stub('gui.ts') },
      { find: '@hanzogui/lucide-icons-2', replacement: stub('icons.ts') },
      { find: '@hanzo/iam-js-sdk', replacement: stub('iam-sdk.ts') },
      { find: '@zap-proto/web', replacement: stub('zap-web.ts') },
      { find: '@zap-proto/zap', replacement: stub('zap-zap.ts') },
      { find: 'ethers', replacement: stub('ethers.ts') },
    ],
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://console.hanzo.ai' } },
    include: ['test/unit/**/*.test.ts'],
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
  },
})
