# AGENTS — console2

Read [LLM.md](./LLM.md) first; it is the canonical design doc. Highlights for
agents working here:

- **Stack:** Next.js 15 (app router) + @hanzo/gui (npm), consumed at runtime via
  `transpilePackages` (the `@hanzogui/next-plugin` is broken on npm). Next 15
  (not 14) because @hanzo/gui needs React 19. Pin patch versions; never lazily
  major-bump.
- **Gui style props:** the v5 config is `onlyShorthandStyleProps` — use
  shorthands (`p`, `px`, `bg`, `items`, `justify`, `self`, `rounded`, `minH`),
  never longhands (`padding`, `backgroundColor`, …). Keep `tsc` clean.
- **One way:** all backend calls go through `src/lib/api` (never raw `fetch`);
  all selects/inputs through `src/components/ui/Field.tsx`; all nav/routing
  through the registry in `src/lib/products`.
- **Extensibility:** add a cloud product by appending a `ProductModule` to
  `src/lib/products/registry.tsx` and writing its module component — do not add
  per-product routes or touch the shell.
- **Auth:** Hanzo IAM (OIDC) via `@hanzo/iam-js-sdk`; session cookie minted by
  the backend at `/v1/signin`. Never store credentials client-side.
- **Boundaries:** frontend only. No DB. No Docker builds locally (CI/CD builds
  images). No secrets in the repo — config is `NEXT_PUBLIC_*` only.
- **Verify:** `npm run typecheck` and `npm run build` must pass. Show output.
- **Tests (real, committed under `test/`):**
  - `npm run test:unit` — vitest, pure client logic + catalog/data-integrity
    (routing, registry, config, the `/v1` client envelope, domain `logic.ts`).
    Heavy GUI deps are aliased to hermetic stubs (`test/stubs/`) so the registry
    graph imports without rendering Tamagui in Node.
  - `npm run test:e2e` — Playwright against the real Next server (builds + serves
    via `webServer`). HERMETIC: the `/v1` + `/paas` backend is mocked with route
    interception (`test/e2e/fixtures.ts`) — tests NEVER touch real prod data.
    Fixtures: `ACCOUNTS.admin/member/anonymous`, `backend.account()/envelope()/
    rest()/error()/paas()`, `baseline()`, `landAs()`, `trackConsoleErrors()`.
  - `npm run test:all` — both. E2E scopes assertions with the `nav-sidebar`,
    `page-content`, and `pinned-section` testIDs on the shell.
