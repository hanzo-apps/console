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
