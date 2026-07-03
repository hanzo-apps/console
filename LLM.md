# console2 — Hanzo Cloud Console

Unified admin console for **Hanzo Cloud** and all cloud products. Our code,
BSD-3-Clause, built on **@hanzo/gui** (the Tamagui-based cross-platform UI).
NOT a Langfuse fork, NOT casibase — it is a clean client over the unified `/v1`
backend (`hanzoai/cloud`, the casibase API at https://cloud.hanzo.ai/v1/*).

## Base: Next.js 15 (app router) + @hanzo/gui

The @hanzo/gui `expo-router` template was evaluated first and **rejected for a
standalone repo**: it declares `workspace:*` dependencies (`hanzogui`,
`@hanzogui/config`, `@hanzogui/babel-plugin`, …) that only resolve inside the gui
bun monorepo — `npm install` of a copy fails with
`EUNSUPPORTEDPROTOCOL "workspace:"`. It is also native-first with no real
typecheck (`"test": "true"`), a poor fit for a data-heavy web admin.

So the base is **Next.js + @hanzo/gui (npm)**. Gui is consumed at **runtime**:
Next's built-in `transpilePackages` transpiles the Gui ESM packages (discovered
from `node_modules/@hanzogui`, not hardcoded) and `GuiProvider` injects CSS at
runtime. Gui is designed to work this way — the optimizing compiler is an
optimization, not a requirement.

The canonical `@hanzogui/next-plugin@7.3.0` is **broken on npm**: it depends on
`hanzogui-loader@7.3.0` (unpublished — only `2.x`/`102.x` fork tags exist), and
that fork renames the export the plugin imports (`GuiPlugin` → `HanzoguiPlugin`).
Pinning the fork via overrides surfaces the rename at build time. So the plugin
is unusable standalone; `transpilePackages` is the clean, supported path.

**v5 config uses `onlyShorthandStyleProps`** — components use Gui shorthand style
props (`p`, `px`, `bg`, `items`, `justify`, `self`, `rounded`, `minH`, …), not
longhands. With shorthands, `tsc --noEmit` (strict) passes clean and the build
type-checks with no suppression.

**Next 15, not 14:** @hanzo/gui requires `react>=19`. Next 14 ships React 18 and
cannot run React 19 (App Router server components are version-locked to the
bundled React). Next 15.5.x is the current stable that natively supports React
19 — so 15 is the correct, non-degrading choice. The task's "Next 14" is
impossible without downgrading Gui or breaking the peer tree.

## Layout

```
app/                         Next.js app router
  layout.tsx                 html shell, dark default, mounts <Provider>
  globals.css                base resets (Gui CSS injected via plugin)
  signin/page.tsx            sign-in (delegates to IAM)
  auth/callback/page.tsx     OIDC callback -> /v1/signin -> session
  (dashboard)/
    layout.tsx               AuthGate + DashboardShell
    page.tsx                 product overview cards
    [...slug]/page.tsx       catch-all: resolves a module+route from the registry
src/
  config/index.ts            single env reader (NEXT_PUBLIC_*), branding
  lib/
    api/                     typed /v1 client (ours)
      client.ts              core request: cookies, envelope unwrap, ApiError
      types.ts               Provider, ModelRoute, Application, Store, Chat, Account
      providers|model-routes|applications|stores|chats|account.ts
      index.ts               barrel
    auth/
      iam.ts                 @hanzo/iam-js-sdk wrapper (browser-only), getSigninUrl
      session.tsx            SessionProvider/useSession (account, signIn, signOut)
    products/
      registry.tsx           ProductModule[] — the extensibility backbone
      match.ts               slug -> {module, route, params}
  components/
    Provider.tsx             GuiProvider + next-theme + SessionProvider (dark)
    DashboardShell.tsx       sidebar (from registry) + topbar (adapts dashboard-shell recipe)
    AuthGate.tsx             gate authenticated routes
    SignInForm.tsx           adapts sign-in-form recipe; IAM redirect
    ui/                      PageHeader, DataTable, Field*
    products/
      ProvidersModule.tsx    FULL surface: list + view/edit
      providers/             logic.ts (pure cascade/visibility), List/Edit views
      ModelsModule.tsx       routes list <-> new/edit
      models/                logic.ts (newModelRoute), ModelRoute List/Edit views
      ApplicationsModule.tsx routes list <-> edit
      applications/          logic.ts (newApplication), List/Edit (deploy/undeploy)
      StoresModule.tsx       routes list <-> edit
      stores/                logic.ts (newStore), List (refresh-vectors)/Edit views
      ChatModule.tsx         routes list <-> read-only chat view
      chat/                  ChatListView + ChatView (message thread)
```

Each product module mirrors Providers: a router module (`<X>Module.tsx`), a
list view + an edit/view, and a pure `logic.ts` (new-record templates / option
lists). Every module declares a `''` (list) and `:name` (edit/view) route in the
registry; Models also handles `:name === 'new'` for create (model routes are
keyed by `owner/modelName`, so modelName is form-entered, not generated).

## /v1 backend client

One `request()` in `lib/api/client.ts`: always `credentials: 'include'` (the
backend sets a session cookie at `/v1/signin`), forwards `Accept-Language`,
unwraps the casibase `{ status, msg, data, data2 }` envelope, throws typed
`ApiError` (401/403 carry status). Base URL = `config.cloudUrl` (default
`https://cloud.hanzo.ai`, override `NEXT_PUBLIC_CLOUD_URL`).

Endpoint surface ported from `hanzoai/ai` `web/src/backend/*.js`
(see `docs/endpoints.md`):
- **ProviderApi** — get-global-providers, get-providers, get-provider,
  add/update/delete-provider, refresh-mcp-tools
- **ModelRouteApi** — get(-model-routes|-route), add/update/delete-model-route
- **ApplicationApi** — get(-applications|-application), add/update/delete,
  deploy/undeploy-application
- **StoreApi** — get-global-stores, get-stores, get-store, get-store-names,
  add/update/delete-store, refresh-store-vectors
- **ChatApi** — get-global-chats, get-chats, get-chat, add/update/delete-chat
- **AccountApi** — get-account, signin, signout

## Auth (Hanzo IAM)

`@hanzo/iam-js-sdk` against **`hanzo.id`** — the canonical OIDC issuer
(`iss=https://hanzo.id`), the one the cloud `/v1` backend validates. `getSigninUrl()`
builds the authorize URL (`https://hanzo.id/login/oauth/authorize?...redirect_uri=
<origin>/auth/callback`). IAM returns `?code&state`; the callback posts them to
`/v1/signin`, which the cloud backend exchanges and mints the session cookie;
`useSession` then loads `/v1/get-account`.

App/client is **`hanzo-cloud`**, org `hanzo` — NOT a console-specific app. console2
is a front-end OF the shared cloud `/v1` backend, which exchanges the code and
validates the token as app `hanzo-cloud` (`aud=hanzo-cloud`), so the browser MUST
present the same `client_id`. (The `hanzo-cloud` IAM app already whitelists
`https://console2.hanzo.ai/auth/callback`.)

**Build-time gotcha (the 2026-06 sign-in bug):** every `NEXT_PUBLIC_IAM_*` is
inlined at BUILD time (browser config), so the *image* — not runtime env — decides
the issuer. The mainnet image MUST bake `NEXT_PUBLIC_IAM_URL=https://hanzo.id`.
Baking `iam.hanzo.ai` (the legacy zone, `iss=https://iam.hanzo.ai`) dropped the user
on iam.hanzo.ai with an issuer mismatch. Fixed in `src/config/index.ts` (default),
`.env.example`, the `Dockerfile` ARG default, and the mainnet `iam_url` build-arg in
`.github/workflows/build-image.yml`.

## Product-module registry (extensibility)

`lib/products/registry.tsx` is the single source of nav + routing truth. Each
cloud product is a `ProductModule { id, label, icon, description, routes }`. The
sidebar, overview, and the catch-all route all render from it. **Adding a cloud
product = appending one entry + its module component(s); no shell or route
edits.** A module owns its routes and components and knows nothing about
siblings (orthogonal).

## Dev

```bash
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_IAM_CLIENT_ID for live auth
npm run typecheck            # tsc --noEmit (strict) — clean
npm run build                # next build (type-checks; Gui CSS injected at runtime)
npm run dev                  # http://localhost:4000
```

Data layer is the unified `/v1` backend — this repo is frontend only. Do NOT
add Postgres/Mongo/etc. Do NOT build Docker images locally (CI/CD does that).

## Cloud console — 10-category CLOUD AXIS + embedded PaaS (feat/cloud-taxonomy-10cat)

The catalog (`src/lib/products/registry.tsx`) is reorganized from 6 ad-hoc
categories to the canonical **10-category cloud axis** (the same taxonomy as the
hanzo.ai product surface, `/tmp/hanzo-cloud-taxonomy.md`), so console2 reads like
a cloud console (GCP/AWS) — resources grouped by cloud primitive, two rows of
five:

```
AI        Compute     Data        Network     Security
Dev       Deploy      Observe     Chain       Apps
```

**Three entry kinds, zero dead links, zero fakes** (`CatalogEntry.kind` +
`status`):
- `module`  — in-console admin surface (Providers/Models/Chat/Stores=Vector/
  Applications, + the embedded PaaS).
- `external`— a REAL Hanzo product on its own domain (Inference→api.hanzo.ai,
  Search→search.hanzo.ai, Bot→hanzo.bot, IAM→iam, KMS→kms, Observe/Traces/
  Dashboards→console.hanzo.ai, Analytics, Cost→billing, Object Storage→s3,
  Edge, Flow, Sign, Crawl, Studio).
- `soon`    — a real cloud primitive without a UI yet (GPUs, VPC, HSM, Settlement,
  …). Renders an HONEST in-console "coming soon" overview (`ComingSoon.tsx`,
  resolved by id from the path) that points at the API/CLI — **never a 404 and
  never a fabricated product card**. A `soon` entry is a `module` under the hood
  (single route → `ComingSoon`), so routing is unchanged.

The nav shell, catalog home, favorites, and router still render from the one
`catalog` list. `status: 'soon'` shows a "Coming soon" badge + affordance.

### Job 3 — PaaS embedded natively under Deploy (NOT an iframe)

`PlatformModule.tsx` is the embedded PaaS, wired to the REAL platform.hanzo.ai
control plane. The browser calls console2's OWN origin under `/paas/*`; the
server route `app/paas/[...path]/route.ts` forwards to `platform.hanzo.ai/v1/*`
with the service token from **server-only** env `PAAS_SERVICE_TOKEN` (sourced via
KMS — never `NEXT_PUBLIC_`, never in the browser bundle, no CORS). It lists real
apps across clusters with **declared vs running tag + drift** and a real
health-gated **redeploy** (`POST /v1/apps/<id>/redeploy`). The six Deploy
sub-pages (Projects/Environments/Builds/Registry/Releases/Pipelines) are tabs
over the same real inventory. States are honest: loading, **not-configured (501
when `PAAS_SERVICE_TOKEN` is unset)**, error, empty — it never invents rows.
To light up real data in prod: add `PAAS_SERVICE_TOKEN` (+ optional
`PLATFORM_URL`) to the console2 deployment env via a KMSSecret.

### Job 4 — no fake/placeholder/stub data

The catalog is honest by construction (every leaf → real module, real product
domain, or honest `soon` overview). The PaaS embed shows only real control-plane
data with honest empty/not-configured states. No lorem stats, no demo projects,
no placeholder cards.

Build: arcd self-hosted CI (`.github/workflows/build-image.yml`, push to `main` →
`ghcr.io/hanzoai/console:v<package.json version>`, SEMVER only). The
`hanzo-build-linux-amd64` ARC runner pool is the builder (online; not GHA-hosted).

Deploy: console IS an operator `Service` CR now (`hanzo.ai/v1`, `hsvc console`,
ns `hanzo`) — declared in `universe/infra/k8s/operator/crs/console2-v1.yaml`.
Bump `spec.image.tag`, `kubectl apply`, the operator reconciles. Verify live with
headless Playwright on console2.hanzo.ai.

## Live E2E product-bug fixes (v8.4.54)

Five "advertised-but-broken" surfaces the live E2E suite flagged, fixed honestly
in the client (no fabrication):

- **Vector module rendered nothing.** `GET /cloud/v1/vector` 200'd but the module
  blanked while SQL/KV rendered — the vector provisioning backend 200s a WRAPPED
  body (not a bare `Resource[]`), so the list view's `for…of` threw during render
  behind the error boundary. Fix: `normalizeResourceList` in `lib/api/provisioning.ts`
  validates + unwraps the list at the TRANSPORT boundary (bare array, or a
  `{data|items|results|resources|collections|list|rows}` wrapper incl. one level of
  nesting like Qdrant `result.collections`), honest `[]` fallback — ONE place, every
  kind. Don't add per-kind unwrap in the view.
- **`/chat` reply now STREAMS.** The composer already POSTed a working completion;
  it now renders token-by-token via `AiApi.ragChatStream` (grounded RAG headers ride
  `PlaygroundApi.streamChat`). The SSE parser's canonical home moved to
  `lib/api/stream.ts` (ONE definition, re-exported from `playground/stream.ts`);
  the error card's Retry now re-runs the last user turn (was a no-op — input is
  cleared on send).
- **Functions list self-freshens.** `useReloadOnFocus` (`lib/use-reload-on-focus.ts`,
  pure `armReloadOnFocus` core + tests) refetches on window focus / tab-visible, so
  an API/CLI-deployed function appears without a manual reload; plus a header Refresh.
- **Sign-out redirects deterministically.** `session.tsx` `signOut` now hard-navigates
  to `/signin` after `DELETE /auth/session` (AuthGate's reactive redirect could be
  pre-empted by an in-flight session re-hydrate, stranding the user on `/`).
- **CRM summary rollup lag = BACKEND.** The console already refetches
  `/v1/crm/summary` after every create/delete (`onChanged → loadSummary`). The +1 lag
  is the cloud-api materialized rollup (eventual consistency); flagged for the backend
  — NOT faked client-side (no optimistic increment).

## Live verification + backend wiring (v0.1.8)

> v0.1.7 was a parallel CTO branch (`fix/paas-live-data`) that wired only
> Clusters/Kubernetes/Status to the platform `/v1` surface; it is integrated here
> (`-s ours`) and superseded — v0.1.8 is the cumulative release with the full set
> below.

Every embedded module was Playwright-verified live against the real `/v1` backend
(authenticated hanzo-org admin). The backend topology console2 actually talks to:
the same-origin `/v1` ingress routes to **cloud-api** directly (NOT the full
api.hanzo.ai gateway), and `/paas/*` is console2's own server route → platform.

Findings + fixes (all in console2; honest states everywhere, no fakes):
- **X-Org-Id (the big one).** The provisioning sub-service (vector/sql/kv/s3/
  datastore/docdb/search) requires an `X-Org-Id` header and 403s `"X-Org-Id
  required"` without it — cloud-api on the direct path does NOT inject it from the
  session. Fix: `lib/api/client.ts` now stamps `X-Org-Id: config.iamOrgName`
  (brand org, the user's own) on every cloud call (`baseHeaders`). All 7 data
  modules now return real data / honest empty `[]`.
- **PaaS token was wrong.** The CR wired `PAAS_SERVICE_TOKEN` to
  `hanzo-paas/MASTERTOKEN` (`hanzo-master-token`), which platform.hanzo.ai
  **rejects (401)**. The correct token is in secret **`paas-console-token`** key
  `PAAS_SERVICE_TOKEN` (== `platform-service-token`). CR repointed there.
- **Platform contract was wrong.** The real platform serves `GET /v1/apps` (the
  apps inventory: declared/running/latest tag + drift + health + cluster +
  namespace, ~100 services) and `GET|POST /v1/org/{org}/cluster` — NOT
  `/v1/clusters` and NOT any `/k8s/{kind}` passthrough (those 401/404). `lib/api/
  platform.ts` reworked to `PlatformApi.apps()` + org-scoped `listClusters`/
  `provisionCluster`; dead `KubernetesApi`/`CLUSTER_ROUTES` removed.
  - **Status** now reads `/v1/apps` → REAL health board (Services/Healthy/Clusters).
  - **Kubernetes** now reads `/v1/apps` → REAL workloads per cluster (picker from
    the clusters that actually appear).
  - **Clusters** lists real dedicated DOKS via `/v1/org/{org}/cluster` (honest
    empty; provision form wired to the real endpoint). Attach-by-kubeconfig dropped
    (no backend).
  - `interpretPlatformError` maps upstream 401/403 → honest "not configured".
- **Bot** `/v1/bot/health` 404s on cloud-api (bot-gateway runs behind
  api.hanzo.ai/hanzo.bot, not this host) → honest "not routed on this host" state
  (was a red error).
- **Wallet** cloud-credit `/v1/billing/balance` 404s here (billing ships
  separately) → honest "not available on this deployment" (was a scary error).
  HUSD balance/top-up already honest "coming" (token unconfigured).
- **Providers was broken** — `ProviderListView`/`ProviderEditView` imported the
  ZAP twin (`~/lib/zap`), but the cloud `/zap` WS face is NOT served (the edge
  returns SPA HTML, 200 not a WS upgrade — documented in `lib/zap/client.ts`), so
  the module showed "Failed to load providers". Switched both back to the working
  REST `~/lib/api` (identical surface). The ZAP twin stays as the proof-of-pattern
  until `/zap` is bound. Providers now shows real/empty over REST like every module.
- Already-correct honest states (unchanged): IAM/Audit + KMS/Secrets (`/v1/iam`,
  `/v1/kms` 404 → "not available on this deployment"); Observability (`/v1/o11y`
  503 → "runtime not initialized"). Plans/Embeddings show real data; Models/
  Providers/Applications/Chat honest-empty.

`StatusTag` now also understands platform health verdicts (green/yellow/red).

## Working AI + API keys + chrome polish (v0.6.0)

The investor-demo wave. ROOT CAUSE of "chats/playground don't work": the gateway
chat endpoints REQUIRE `Authorization: Bearer` — a session cookie alone is
rejected ("Invalid API key format"). The browser sent cookie-only, so every AI
call (chat, playground, cmd+K `>`/`?`) failed. Fixed with two server routes that
keep all credentials server-side (the browser only ever sends its session cookie):

- **`app/ai/[...path]/route.ts`** — keyless AI proxy. Resolves the user from the
  session cookie (cloud `/v1/get-account`), mints a SHORT-LIVED user-bound IAM
  token (`/v1/iam/issue-user-token`, cached per-user until ~60s pre-expiry) as the
  confidential `hanzo-console` client, and forwards to `AI_GATEWAY_URL/v1/<path>`
  with `Bearer <token>`. Allow-listed to `v1/models|chat|chat/completions|
  embeddings|rerank` (not a general tunnel). `playground.ts` now points at this
  proxy (`<origin>/ai`), so Models/Playground/Chat/cmd+K all work with no key in
  the browser and no rotation on a chat turn.
- **`app/keys/route.ts`** — per-user `hk-` Cloud API key. POST mint/rotate, DELETE
  revoke, GET status (no secret). Same app-on-behalf pattern via
  `/v1/iam/mint-user-keys` + `/v1/iam/revoke-user-keys`. The `hk-` secret is shown
  ONCE (POST). `ApiKeysModule` is now create/copy/rotate/revoke.
- Shared trust boundary: `src/lib/server/identity.ts` (server-only) — `resolveUser`
  + `mintUserKey`/`revokeUserKey`/`issueUserToken`. The `hanzo-console` client is
  allow-listed in IAM `IAM_KEY_MINT_ALLOWED_APPS`; verified end-to-end that a
  minted `hk-` key and an issued user JWT both 200 on `api.hanzo.ai/v1/chat/
  completions`.
- **Chat is interactive** (`chat/ChatConversation.tsx`): a real multi-turn
  conversation over `AiApi.chat` (→ the `/ai` proxy), with a Zen default model,
  honest 402 "add credits" state, and a "History" toggle to the old session list.
- **Chrome**: the sidebar/header show the Hanzo **H mark + "Console"**
  (`ui/HanzoMark.tsx` + `ui/BrandLogo.tsx`; `BrandLogo` shows the org's IAM logo
  when set, else the H). A fullscreen **app launcher** (`components/AppLauncher.tsx`,
  Launchpad-style grid + filter) opens from the header "Apps" button, the sidebar
  grid icon, and the command palette's "Browse all apps". cmd+K stays the palette.

Server-only env the routes need (added to `console2-v1.yaml`, never `NEXT_PUBLIC_`):
`IAM_URL`, `CLOUD_API_URL` (in-cluster cloud-api), `AI_GATEWAY_URL` (api.hanzo.ai),
and `IAM_MINT_CLIENT_ID`/`IAM_MINT_CLIENT_SECRET` from secret `hanzo-console-iam-creds`.

## Admin console live data + org switching (v0.7.0)

The "models empty" + "org switcher broken" wave. ONE root cause: `/v1/iam`,
`/v1/kms`, `/v1/models` 404 (or 401 cookie-only) on the console host, so the
catalog, switcher, IAM, and KMS modules rendered honest-empty. Fix = route every
privileged call through console2's OWN server proxies (which add the user bearer +
the admin gate), and make org scope a first-class, switchable value.

- **Model catalog (the "models missing" bug).** `CloudModelApi.list()` hit cloud
  `/v1/models` with a cookie only → 401 → empty. Repointed at the `/ai` proxy via
  the shared `aiV1Url('models')` (`lib/api/client.ts` now owns `aiBase`/`aiV1Url` —
  ONE place defines the proxy origin; `playground.ts` uses it too). The proxy mints
  a short-lived user token, so the catalog populates with the live Zen models.
  Pricing stays best-effort on the cloud origin (degrades to "—", never fabricated).
- **Org scope is a value, not a place** (`lib/org-scope.ts`). `currentOrg()` /
  `setCurrentOrg()` / `isScopedAway()` / `filterOrgs()`. Default = the brand org;
  a global admin (z@hanzo.ai) can switch to ANY org. Brand identity (host wordmark/
  logo) is orthogonal and unchanged — only the DATA scope moves. `client.ts`
  `baseHeaders` now stamps `X-Org-Id: currentOrg()` (was the fixed brand org), so
  every cloud-data module re-scopes on switch.
- **OrgSwitcher** lists ALL visible orgs (`IamAdminApi.organizations()` via the
  `/admin/iam` proxy → global admin sees every org), adds a **filter** box
  (`filterOrgs`), and **switches in place**: `setCurrentOrg` + reload refetches
  every module under the new `X-Org-Id`. The IAM/KMS proxies authorize a global
  admin for any org and pin a brand admin to their own, so the re-scope is safe.
- **IAM module** (`AdminModule.tsx` `IamModule`/`AuditModule`) reads users/roles/
  records for `currentOrg()` (the org list itself is unscoped — what powers the
  switcher). **KMS module** (`KmsModule.tsx`) was a dead cloud-path probe; now a
  names-only inventory over `KmsAdminApi.list({ org })` (the `/admin/kms` proxy +
  kmsd's metadata-list endpoint, v0.159.4+). Values are NEVER fetched/rendered;
  honest states: loading, operator-access-required (403), listing-unavailable (404),
  empty.
- **Decomplected gate** (`lib/server/admin-policy.ts`, pure, tested). `gateAllows`
  (`@<adminDomain>` email AND IAM admin), `ownerAllowed`, `orgFor` — extracted from
  `getAdminGate` + the IAM/KMS routes so the SAME predicate that ships is the one
  unit-tested. A brand admin can never `orgFor` to another org's KMS (no secret
  leak across orgs).
- **Tests** (vitest, `npm test`): `admin-policy.test.ts` (gate allow/deny + tenant
  scoping), `org-scope.test.ts` (default→switch→reset + filter), `models-catalog.
  test.ts` (catalog fetches `<origin>/ai/v1/models`, never the cookie-only cloud
  path). RED→GREEN, 22 tests. `tsc --noEmit` + `next build` clean.
- The console2 CR already carries the env the proxies need (`IAM_URL`,
  `CLOUD_API_URL`, `AI_GATEWAY_URL`, `IAM_MINT_CLIENT_*`); `KMS_URL` defaults to
  `http://kms.hanzo.svc`. `admin.hanzo.ai` added to the CR ingress hosts.

## First-run org onboarding + waitlists (v0.7.8)

This release is based on the live GitHub `main` at `88d4c68` (v0.7.7), including
the org → project → environment scope model. `Projects` remains a single Deploy
module backed by the IAM project endpoints and the top-bar `ScopeSwitcher`; do
not add a duplicate Apps/Projects entry.

- **One instruction source.** `AGENTS.md` and `CLAUDE.md` are symlinks to
  `LLM.md`; keep agent guidance here only so Codex and Claude stay in sync.
- **First-run org onboarding.** `OrgGate` now sends signed-in users with no org
  to `OrgOnboarding` instead of a dead "no organization" state. The same-origin
  `/onboard` route acts as the confidential `hanzo-console` IAM client, creates
  a customer org (or personal org), moves the caller into it as admin, then the
  client re-authenticates so the new session carries the org. Normal privileged
  routes still use `resolveUser()` (org required); onboarding alone uses
  `resolveAuthenticatedUser()` so it can handle the zero-org session safely.
- **Coming-soon waitlists.** `ComingSoon` renders `WaitlistForm`, which posts to
  `/waitlist`. The server route requires a session and forwards to
  `WAITLIST_URL/v1/waitlist/join`; when `WAITLIST_URL` is unset it returns an
  honest 501 and never fabricates a confirmation.
- **Motion primitive.** `FadeIn` plus the single `.hz-fade-up` keyframe in
  `globals.css` is the shared entrance animation. It honors
  `prefers-reduced-motion`.

Server-only env added by this wave: `WAITLIST_URL` for waitlist forwarding. Org
onboarding uses the existing `IAM_URL`, `CLOUD_API_URL`, and
`IAM_MINT_CLIENT_ID`/`IAM_MINT_CLIENT_SECRET` confidential-client wiring.

## CI base image mirror (v0.7.9)

The ARC runner was still blocked by Docker Hub's unauthenticated pull limit while
pre-pulling `node:22-alpine`. `Dockerfile` now uses
`public.ecr.aws/docker/library/node:22-alpine` for all stages, and
`.github/workflows/build-image.yml` pre-pulls the same ECR Public Docker-library
mirror image. This keeps the host-builder cache behavior but removes Docker Hub
from the cold-runner path.

## Console parity audit + remaining feature ports (2026-06-29)

Old `console/web/src/pages/project/[projectId]` still had routes with no
console2 destination: experiments, dashboard/widgets, integrations
(blob-storage, Slack, Mixpanel, Insights), referrals, zero-trust, prompt
detail/create/metrics, dataset items/runs, annotation queue detail/items, and
score analytics. These are now represented in console2 without copying the old
Langfuse internals.

- `ConsoleFeatureModule.tsx` is the shared forward-compatible shell: each moved
  surface declares its exact `/v1` endpoint, renders real rows when the endpoint
  exists, and uses `BackendStateCard` for 404/405/503/access/billing. It never
  fabricates rows.
- New catalog entries: `experiments`, `integrations`, `referrals`, and
  `zero-trust`. `dashboards` is now a native module with an external handoff to
  analytics.hanzo.ai instead of external-only. `scores/analytics` is routed as a
  score subpage.
- Expanded existing modules: Prompts now has list/detail/create/metrics routes;
  Datasets has datasets/items/runs; Annotation Queues has queue detail + work
  items. `EvalsApi` and `O11yApi` carry the corresponding typed
  forward-compatible methods.
- Verification for this wave: `npm run typecheck` and `npm test` both pass
  locally (48 Vitest tests).

## Embeddings — full product surface (feat/embeddings-page)

The `embeddings` catalog entry is upgraded from the old single Stores admin
(`StoresModule`, now deleted along with `StoreListView` — superseded, not
duplicated) into a six-tab product over the REAL `hanzoai/ai` `/v1` backend.
`StoreEditView` + `stores/logic.ts` (`newStore`) are reused for the collection
editor + create; nothing is forked.

- **EmbeddingsModule** routes `''`→Overview, `:tab`→Overview/Explore/Collections/
  Jobs/Models/Settings, `collections/:name`→the store editor (unambiguous by
  segment count — same pattern as Models' `:tab`). The ONE create path
  (`add-store` + `newStore`) backs both the header "Create collection" and the
  Collections "New".
- **Collections = stores.** `EmbeddingsApi.collections` = `get-stores` → a
  `Collection` view-model; each maps to the Qdrant/Search index
  `{owner}-{store}-docs` (the backend's `GetSearchIndexName`). The store object
  carries NO vector count / dimension / index-size / `updatedTime`, and the metric
  is fixed to cosine at index-create — so those columns render an honest "—"
  (CREATED shows `createdTime`, the only timestamp; the metric is the real cosine).
- **Explore** → real `POST /v1/search?store=` (`{query,limit,mode}` → `{hits}`).
  Hits carry no per-hit score (backend RRF-drops it) so score reads "—";
  url/breadcrumbs are the locator. Model+Dimension are read-only collection
  metadata (search uses the store's own embedding config, not query-time).
  Vector-inspect is honest-empty (no point-lookup endpoint).
- **Models** = `/v1/models` filtered by id (no category field exists; many
  embedding routes are `hidden` and absent — honest); generate = real
  `POST /v1/embeddings` via the keyless `/ai` proxy (already allow-listed).
- **Jobs** = per-file index status (`get-files`: Pending/Processing/Finished/
  Error — there is no async job entity) + a real upload ingest
  (`POST /v1/docs/ingest`, source=upload).
- **Overview** metric cards (vectors/storage/queries/latency/cost) read
  `GET /v1/get-cloud-usages` — a forward-compatible client coded to the documented
  shape that degrades EVERY field to "—" with no sparkline today (the read API
  has no unique commits yet on `feat/cloud-usage-read-api`). The model donut is
  the real collection-by-model mix; dimension bars light up when metering reports
  per-dimension counts; index-health is per-collection state enriched best-effort
  with live `/v1/search/stats`.
- New: `src/lib/api/embeddings.ts` (`EmbeddingsApi`), the pure
  `components/products/embeddings/logic.ts` (+15 Vitest), and the dependency-free
  `components/ui/Charts.tsx` (Sparkline/Donut/BarChart — monochrome SVG, render
  nothing/"—" rather than a fabricated trend).
- Shared-infra touched: registry (`embeddings` row upgraded, not duplicated),
  `lib/api/index.ts` (barrel export). Reuses the unified `EmptyState`,
  `BackendStateCard`, `DataTable`, `PageHeader`, `PrimaryButton`, `Field*`.
- Drive-by: corrected a STALE assertion in `admin-policy.test.ts` — the
  `built-in` org-metadata owner was deliberately dropped in v0.7.15 (9b59dec,
  "standardize the global-admin org on 'admin'") but the test still expected the
  old wider allow-set; the gate code is unchanged (the tighter shipped policy is
  the correct one).
- Verification: `tsc --noEmit` clean, `vitest` 67/67 (8 files), `next build`
  green (14/14 pages). Authenticated visual e2e is gated behind a deploy + IAM
  session — left for live verification (the catch-all `/[...slug]` route that
  renders this compiled and type-checked).

## Native control planes — ZERO external link-outs + Hanzo Functions (claude/console2-native-control-planes)

Three deliverables, one PR, all over the one `/v1` surface (no `/api/` prefixes).

- **No external link-outs (the priority).** The catalog's `external` kind is GONE:
  `CatalogEntry` is now `module`-only and `ProductStatus` is `'enabled' | 'soon'`.
  Every product that used to open another domain in a tab (Gateway, DNS, CDN, MPC,
  CLI, SDKs, API, IDE, Desktop, Registry, Metrics, Crawl, Studio, Console) is now a
  native in-console route. They render ONE shared `NativeOverview`
  (`components/products/overview/NativeOverview.tsx`, wired via `overviewFor(id)` +
  `overviewRoutes(id)` in the registry — the DRY twin of `soonRoutes`): header +
  what-it-is, a REAL health band (probes `PlatformApi.apps()` for the product's
  operator service; honest "not deployed / not reporting" states, never a fabricated
  "operational"), key-fact cards (honest "—"), native primary actions (in-console
  routes only), and INLINE docs (rendered in-console; the docs SITE is a small
  secondary reference, never the way to use the product). Content is a pure
  `OverviewSpec` per product (`overview/spec.ts` + `resolve.ts` — a catalog-derived
  `defaultSpec` covers any product with no bespoke spec). The `external` branches in
  `open.ts`, `DashboardShell`, `AppLauncher`, `CommandPalette`, `ProductInterstitial`,
  and `OverviewModule` are removed — there is one way to open anything: a native route.
- **Hanzo Functions dashboard.** `FunctionsModule` is rebuilt from the old single
  `/paas/functions` table into a polished tabbed product (Overview · Functions ·
  Deployments · Triggers · Secrets · Settings, `:tab` route like GPUs/Models) over
  the rich `lib/api/functions.ts` (`GET /v1/functions*`). Branded **Hanzo Functions**
  with the honest **Fission** engine badge (the mock said "OpenFaaS", but the live
  engine per `go.mod` + `universe/infra/k8s/functions` is Fission — we label the real
  one). Overview: 6 KPI cards (Functions/Invocations 7D/Success/Avg duration/Errors/
  Cost) derived from real rows via `deriveOverview` (each degrades to "—"), with real
  series sparklines + `trendPct` deltas; an "Invocations over time" `LineChart` with
  1H/6H/24H/7D/30D range toggles; an "Invocation status" `Donut`; and the shared
  `FunctionsBrowser` (table + `DetailRail`, DRY across Overview and the Functions tab).
  All chart/donut/cost read `FunctionsApi.metrics(range)`; until that route is bound
  they show honest "time-series not connected" — never a placeholder trend. Secrets is
  names-only (values never fetched — Secret Manager principle). `functions/{FunctionsTable,
  DetailRail,parts}.tsx` (already built on the feature branch) are reused unchanged.
- **Overview "Explore products" — enablement gate dropped.** The home cards lose the
  Enabled/External/Soon `StatusBadge` and the open-vs-learn gate; every product is
  open-for-all with an "Open" (native) + a "Learn more" affordance (the native
  `/discover/:id` interstitial, which itself surfaces docs + OSS source inline — not a
  link-out).
- Idiom: strictly `@hanzo/gui` v5 shorthands (`bg`/`maxW`/`rounded`/`items`/`self`/
  `p`/`px`/`py`/`gap`), matching every existing module. New tests: `overview/resolve.test.ts`
  (spec resolution + honest default; the no-`external`/no-`href` invariant is enforced at
  compile time by the collapsed `CatalogEntry` union). Verification: `npm run typecheck`
  clean (0 errors), `npm test` 298/298 (31 files), and every route (`/functions/*`, all
  native overviews, `/`, `/discover/:id`) compiles + returns 200 on the dev server.
- Repo drive-by: removed the bogus tracked `node_modules` self-symlink blob (mode
  120000 → itself) that broke `npm install`/`vitest`; `.gitignore` already ignores
  `node_modules/`, so it was never meant to be committed.

## Living overview — one reusable, videogame-like overview across products (claude/living-overview)

The admin Platform Overview (KPI tiles + sparklines, usage/cost timeseries, revenue
donut, live activity, alerts, system-health) is now a **reusable `LivingOverview`
component system**, not a one-off. The old bespoke `OverviewModule.tsx` +
`AiMetricsModule.tsx` (+ its `aimetrics/{StatTile,UsageChart,format}` sub-parts) are
**deleted** — superseded, one overview system, DRY.

- **`src/components/products/overview/living/`** — the system:
  - `config.ts` — the DECLARATIVE contract: a `LivingOverviewConfig` names a product's
    tiles (`metric`/`timeseries`/`distribution`/`activity`/`alerts`/`health`, discriminated
    on `tile`) in ordered `rows`, a single REAL-data `load(ctx) => OverviewData`, and a
    `live` block (`pollMs` + `countUp`). Tiles read their slice out of the normalized
    `OverviewData` by key — a missing slice → honest empty tile (over-declaring is safe).
  - `motion.ts` (pure, unit-tested) — count-up curve (`countUpValue` lands EXACTLY on
    target), live-sparkline ring (`pushSample`), self-correcting poll clock
    (`shouldTick`/`effectiveInterval`, hidden-tab-paused). `hooks.ts` — the thin rAF/interval
    drivers (`useCountUp` animates from the CURRENT on-screen value on retarget — smooth;
    `usePoll`, `useReducedMotion`, `usePageHidden`), all self-cleaning (no leaked frames/timers).
  - `logic.ts` (pure, unit-tested) — the tile decisions: unit-aware `formatMetric`
    (count/cents/ms/pct, em-dash for non-finite), `deltaOf` (null → honest "—"), `hasTrend`
    (≥2 real points), status/health/severity colors, `mergeActivity` (dedupe+newest-first for
    the streaming feed), `windowRows` (virtualization), `worstHealth`/`healthTally`.
  - `tiles.tsx` — the thin animated tiles (reuse `ui/Charts` verbatim; count-up + live
    sparkline + skeleton/empty/error paths; the activity stream virtualizes past a viewport).
  - `LivingOverview.tsx` — the driver: ONE throttled poll loop (floored at 5s, paused when
    hidden OR errored), a `reqRef` race guard, range selector; a background refetch never
    blanks a board that already has real data (last real data stays until new lands); the
    first-load failure shows the shared `ErrorState`. `.hz-skeleton`/`.hz-pulse`/`.hz-row-in`
    keyframes in `globals.css`, all reduced-motion-guarded.
- **Backed by REAL `/v1` data, no mocks** (`adapters.ts`, pure, unit-tested): `fromCloudUsage`
  (commerce usage ledger → the platform + AI-usage overviews), `fromAdminOverview`
  (`src/lib/api/admin-overview.ts` — the `/v1/admin/overview` aggregate, optional-safe
  normalizer, degrades to honest empty on 404), `fromFunctions` (real inventory + metrics),
  `healthFromApps` (operator inventory → the health tile, composable into any board).
- **Wired across products** (`overview/living/registry.ts` — the declarative catalog):
  `overview` (platform centerpiece, rendered at `/` home AND `/overview`; primary source
  `/v1/admin/overview`, honest fallback to the real usage ledger + operator health so it is
  never blank), `ai-metrics` (commerce usage), `functions` (inventory + metrics), `gpus`
  (operator inventory). The product route's `''` renders `livingOverviewModule(id)`; the
  tabbed products keep their `:tab` module, reachable from the sidebar's level-2 sub-nav
  (declared `subpages`) so the overview is never a dead-end.
- **Adding a new product overview is one config** — no overview UI:
  ```ts
  // overview/living/registry.ts
  myproduct: {
    id: 'myproduct', title: 'My Product', subtitle: '…',
    live: { pollMs: 15000, countUp: true },
    rows: [
      [{ tile: 'metric', key: 'foo', label: 'Foo', icon: Zap }],
      [{ tile: 'timeseries', key: 'foo', title: 'Foo over time' },
       { tile: 'distribution', key: 'bar', title: 'By kind' }],
      [{ tile: 'activity' }, { tile: 'health' }],
    ],
    load: async ({ range }) => fromMyApi(await MyApi.overview(range)), // REAL data
  }
  // registry.tsx: const MyLiving = livingOverviewModule('myproduct'); route '' → MyLiving
  ```
- **All real, all tested**: `npm run typecheck` clean (0 errors), `npm test` 449/449 (42
  files; +78 new across motion/logic/adapters/registry/tile-contract/admin-overview,
  −10 from the deleted `aimetrics/format.test.ts`), `next build` green (14/14 pages).
  Visual proof (headless Playwright, no live session needed): the platform overview renders
  the full board with count-up KPIs + live sparklines + streaming feed + donut + health
  tally, values change across a 5s poll (live), the reduced-motion path snaps to real values
  with no error, and the `functions`/`gpus` overviews render their honest empty/error states
  (em-dashes + "not reporting" / "Could not load" + Retry) against a feed-less local backend
  without crashing.

## All-pages production build — external→native re-applied + billing/marketplace (claude/console-all-pages)

Branched off `main`; a completeness pass over the whole page taxonomy. Two audits
(a full catalog inventory + a per-module skeptical review) confirmed console2 was
**already ~95% production-complete**: ZERO mock modules, ZERO thin/incomplete modules
— every leaf hits a real `/v1`/proxy feed with honest loading/empty/error states. So
this pass is small and precise, not padding.

- **External→native re-applied (the priority fix).** `main` was inconsistent: `open.ts`,
  `match-core`, `NativeOverview`, `overviewFor` were all collapsed to a no-external world,
  but the registry STILL declared 14 `kind:'external'` entries (gateway, dns, cdn, mpc, cli,
  sdks, api, ide, desktop, registry, metrics, crawl, studio, console). Result: those 14 pushed
  `/${id}` → `resolveProductView` returned `notfound` → **hard 404 dead links** from the
  overview grid + app launcher. (The `claude/console2-native-control-planes` branch had fixed
  this but is 19 commits behind `main` and was never merged.) Fixed here by converting each to
  `kind:'module'` `routes: overviewRoutes(id)` (the DRY twin of `soonRoutes`), rendering the
  already-merged `NativeOverview` from its bespoke `OVERVIEW_SPEC`. `CatalogEntry` union
  collapsed to module-only; `ProductStatus` → `enabled|soon`; dead `external` branches removed
  from `DashboardShell`/`OverviewModule`; stale `ext`/`href` config trimmed. `resolve.test.ts`
  already pins all 14 specs; `match-core.test.ts` updated so the `kind`-guard fails closed for
  a non-module entry.
- **Subscriptions + Payment Methods** (`Observe`, next to `cost`/`plans`) — real commerce via
  the `/billing` per-tenant proxy: `GET /v1/billing/subscriptions`, `GET /v1/billing/payment-methods`.
  `billing.ts` gains `Subscription`/`PaymentMethod` types + normalizers that handle Stripe
  snake_case AND camelCase, the nested `card` object, and Unix-seconds/ms dates. Card data is
  **masked by construction** — the normalizer extracts only brand/last4/exp/isDefault; a
  PAN/CVV/token in the payload is dropped and never reaches the display object (a dedicated
  `billing.test.ts` leak test asserts it). Read-only; add/manage link to the brand portal.
- **Marketplace** (`Apps`, next to `chat`/`bot`/`search`) — the storefront over the real model
  catalog: `aicatalog.fetchCatalog()` → `GET /v1/pricing/models` via the authed `/ai` proxy.
  Category tiles + featured shelf (real catalog flag) + filterable listings with real per-Mtok
  pricing + Try-it→Playground CTA. Reuses the existing `aicatalog` client + `ProviderLogo` — a
  distinct storefront view over the SAME catalog, NOT a duplicate of Model Catalog/Providers.
  Pure `marketplace/logic.ts` (categorize/featured/applyFilters/marketStats) with 16 tests incl.
  a regex-injection guard (search is a literal substring filter).
- **Intentionally NOT built (honest):** Feature Flags / Backups / Support Tickets have NO backend
  anywhere in the Hanzo stack — adding permanent empty-state pages would be fabricated padding.
  Regions/Nodes duplicate `clusters`/`kubernetes`/`machines` (nodes derive from cluster node
  pools; there is no `/v1/machines` route by design). Jobs is intentionally Tasks (registry's own
  decision). No `Billing` category exists in `brand-scope.ts` — billing lives under `Observe`.
- **No cloud changes.** The billing sub-pages ride the existing `/billing/*` proxy (which already
  forwards any path with server-side org scoping); commerce already serves subscriptions +
  payment-methods natively. `go build ./clients/...` clean; cloud version NOT bumped.
- Verification: `npm run typecheck` 0 errors, `npm test` **406/406** (38 files), `next build` ✓
  compiled successfully (lint+types clean). Idiom: `@hanzo/gui` v5 shorthands only.
- **RED review fixes (billing-proxy tenant isolation — the one HIGH finding).** The `/billing`
  proxy's tenant scoping was INERT: it stamped `X-Hanzo-Org` (commerce reads `X-Org-Id` on the
  service-token path — `commerce/middleware/accesstoken.go`; the header fell back to the service
  org) and pinned only `?user=` (subscriptions filter `?userId=` — `commerce/api/billing/
  subscriptions.go`; with no `userId` the query returned every subject's rows = cross-tenant
  leak). Fix: send **`X-Org-Id`** (matching the `/ai` proxy) and pin the **FULL** subject-key set
  `{user,userId,customerId}` — identical to commerce's own `billingSubjectKeys` (`commerce/
  middleware/edgeauth.go`) — so no billing endpoint is left unfiltered whichever param it reads.
  The scoping is extracted to a pure `src/lib/server/billing-scope.ts` (`scopedBillingSearch` +
  `billingSubject`) and unit-tested (`billing-scope.test.ts`, 11 tests incl. the client-forged-
  subject overwrite + two-tenant disjointness). Also (defense-in-depth) `normalizePaymentMethods`
  clamps `last4` to the last 4 digits even if commerce puts a full PAN there (+ test). New live
  two-tenant isolation e2e (`e2e/billing-isolation.spec.ts`) asserts two distinct-org sessions get
  disjoint subscription/payment-method row sets through the proxy. `npm test` **487/487**.

## Consolidation — two Network modules onto main + one authoritative tag (v8.3.1)

The single-consolidator pass that ends the console2 deploy-war: main is the one
authoritative source, the operator CR is pinned to exactly what main builds, and
every stale session branch is pruned. Two genuinely-unmerged Network-category
modules land; everything else was already on main (verified by `git cherry`) and
was deleted, not re-merged.

- **Nodes** (`components/products/NodesModule.tsx`, `app/nodes/[...path]/route.ts`,
  `lib/api/nodes.ts`, `lib/products/brand-scope.ts` `nodeNetworksForBrand`) —
  per-node blockchain infrastructure (validators via P-chain
  `platform.getCurrentValidators` + peers via `info.peers`) over LIVE luxd RPC.
  Same-origin session-gated proxy (mirrors `/bootnode`), brand-scoped DATA
  (hanzo = all networks; lux/zoo/pars = own chain only), honest not-reporting per
  unreachable network. Tests: normalizers over real wire shapes + brand→network
  scope.
- **DNS** (`components/products/DnsModule.tsx`, registry `dns` entry) — per-org
  managed DNS (zones + records → CoreDNS + Cloudflare sync) on the unified
  `/v1/dns` surface; honest BackendStateCard states until the route is bound. The
  cherry-pick collided with main's existing DNS overview stub (same `id:'dns'`),
  resolved by upgrading that well-placed Network-cluster entry to render the real
  `DnsModule` and dropping the duplicate — one id, one entry.
- **Not merged (already on main, branches deleted):** the `/v1/iam` account
  reorg (revert-pair, net no-op; main has #20), the `cloud.hanzo.svc` default
  (main already there), the visor `:19000` default (main already ahead). The
  `api.hanzo.ai`-gateway default change was **rejected**: the CR documents that
  the DOKS pod's egress is Cloudflare-403'd on public `api.hanzo.ai`, so the safe
  env-less default is the in-cluster `cloud.hanzo.svc`.
- Drive-by: the pre-existing `observability/metrics.test.ts` null-override type
  errors are fixed (a `NullablePartial<T>` factory-override type) so
  `tsc --noEmit` is fully green.
- Verification: `tsc --noEmit` clean; `next build` is the authoritative gate
  (Node 24, on-cluster Kaniko — no GitHub builders). One tag `v8.3.1` from main
  HEAD, pinned in `universe/.../crs/console2.yaml`.

## Compute category wired per-org + rich Agents dashboard (v8.4.1, claude/console2-compute-agents)

Every Compute page is wired to its REAL backend, per-org, via the user-bearer BFF
proxies — and a customer (non-admin) never sees the admin `/paas` "PAAS_SERVICE_TOKEN
not configured" message. Plus a rich **Agents** dashboard over `/cloud/v1/agents`.

- **Backends, per page (one proxy each, org resolved from the minted user Bearer):**
  Machines / GPUs / Regions → **visor** `/vm/v1/{machines,gpus,sizes,regions}`;
  Agents / Functions / Prompts → **cloud** `/cloud/v1/*` (allow-listed in
  `proxy-allow.ts`); Containers / Applications → **paas** `/paas`; Tasks → **tasksd**
  `/tasksd/v1/tasks/*`; Edge → honest managed/coming-soon (no backend). Verified live
  in-cluster: visor `/v1/regions|sizes|gpus` = 200 real DO catalog + pricing,
  `/v1/machines` = 403 without the bearer (per-org); cloud `/v1/agents`/`/v1/functions`
  = 404 (concurrent cloud lane binding them), `/v1/prompts` = 200 `{data,meta}`; tasks
  `/v1/tasks/cluster/health` = 200.
- **Agents dashboard** (`AgentsModule` + `lib/api/agents.ts` + `agents/{parts,forms}.tsx`):
  five stat cards (Total / Active / Success 30d / Invocations 30d / Avg latency, spark+
  delta from the real series), invocations-over-time area chart with range toggles,
  Agent Health donut (active/idle/error/draft), agents table (status tabs + pagination,
  version badges, row → detail pane), Recent Activity feed, Top Agents bar list, and a
  30-day Resource Usage panel. EVERY number is real or derived (`deriveAgentStats`,
  `healthBreakdown`, `topByInvocations`, `deriveActivity`) — no fabricated 58-agents/
  1.92M-invocations. Zero agents (or `/v1/agents` 404) → a polished "create your first
  agent" empty state with a REAL New-Agent flow (POST `/v1/agents`; honest "not connected
  — use the CLI" on 404). 22 unit tests.
- **Machines** (role-routed): the customer branch (`CustomerMachines`) now renders the
  real region + size catalog with live pricing (`MachineCatalog` over visor
  `/v1/regions|sizes`) under the "Launch your first machine" state — never a blank
  spinner, proving the backend. Root cause of "not loading" (VISOR_URL unset) already
  fixed on main (proxy default `visor.hanzo.svc:19000` + CR env).
- **GPUs** (now role-routed like Machines): customer → `CustomerGpus` — the real visor
  GPU accelerator catalog (model/count/VRAM/host/price) + the org's own GPU machines;
  admin → the `/paas` operator fleet. The Overview route (`GpusOverview`) is role-aware
  (admin living-overview vs customer catalog). +4 visor catalog normalizer tests.
- **Containers**: the apps-inventory 403 is surfaced as the graceful "Managed control
  plane" card (was masked as a bare empty Workloads table).
- **Edge**: honest "coming soon / managed" state (no real edge backend), real nodes only
  if the platform ever reports them.
- **Shared decomplection** (`platform/state.tsx`): split 401/403 (`forbidden` →
  "Managed control plane", customer-appropriate) from 501 (`not-configured` → the admin
  PAAS_SERVICE_TOKEN hint). ONE fix removes the false infra-token claim for customers
  across every `/paas` module (Containers/Edge/GPUs-admin/Clusters/Kubernetes).
- **Already customer-safe, unchanged:** Applications (cloud `/v1`), Tasks (`/tasksd`
  per-user), Functions (`/cloud/v1/functions`).
- Verification: `tsc --noEmit` clean, `vitest` **639+ green** (all suites; +22 agents,
  +4 visor), `next build` ✓ 14/14 pages. Live visual verification as Dave is post-deploy
  (ships in the merge agent's authoritative image from main HEAD).

## Compute reads CONNECTED — live browser pass fixes (v8.4.2, claude/console2-compute-connected)

Logged in LIVE as Dave (davelorenzini@gmail.com, org maxpower) on console.hanzo.ai
(v8.4.1) and probed every Compute page from the authenticated page context. The
backends ARE up; the fixes are about pages that were CONNECTED but READ AS BROKEN.

- Live map as a customer: `/vm/v1/{regions,sizes,gpus}` = 200 real DO catalog+pricing;
  `/vm/v1/machines` = **403 "Unauthorized operation"** (visor authorizes the public
  catalog but denies the per-org list to a signed-in customer); `/cloud/v1/{agents,
  functions,prompts}` = 200 `{[]}` (connected, empty — maxpower has none); `/tasksd/
  {cluster/health,namespaces}` = 200 (connected, empty); `/paas/apps` = 403 forbidden.
- **Machines** (the visible bug): the page showed "Sign in to view your machines" next
  to the real 14-region + size catalog. `interpretVisorError` now maps **403 → connected
  `unavailable`** (only 401 = a real sign-in); `CustomerMachines` shows "Launch your
  first machine" + the live catalog for both 403 and empty — a signed-in user is never
  told to sign in. (+visor test updated.)
- **platform/state `forbidden`** reframed from a warning ("Managed control plane",
  TriangleAlert) to a CONNECTED state — **"Connected · managed by Hanzo"**, green
  `CheckCircle2`, no Retry — so Containers/Edge/Applications read connected, not error.
- **Applications** repointed from the casibase IAM **OAuth-application** admin
  (`get-applications`/`deploy-application` — an identity concern, mis-placed under
  Compute) to the **deployed application services** (`PlatformApi.apps()` → `/v1/apps`):
  real fleet for an admin, the connected "managed by Hanzo" + deploy-via-Functions/Agents
  state for a customer, honest "nothing deployed yet" when empty.
- **Agents** live 200-empty now shows a "Connected · no agents yet" badge above the
  "create your first agent" state, so it's unmistakably connected (not "not routed").
- **Proxy defaults hardened** (`/vm`,`/cloud`,`/tasksd`): `?.trim() || default` (not
  `??`) so a VISOR_URL/CLOUD_API_URL/TASKS_URL reconciled to an EMPTY string still
  resolves the in-cluster service (observed env drift on the live pod — "keeps getting
  stripped"). Machines/GPUs now ALWAYS reach visor.
- Verified connected as Dave: Machines (real catalog + launch), GPUs (real accelerator
  catalog), Functions/Agents/Prompts (connected-empty), Tasks (connected-empty),
  Containers/Applications/Edge (Connected · managed). `tsc` clean; `vitest` green;
  `next build` ✓ 14/14. (Recovered from a concurrent-agent branch-switch that stashed
  these uncommitted edits — restored + committed in an isolated git worktree.)

## AI product surface LIVE over same-origin /v1/* + canonical shareable agent builder (v8.4.5, feat/console2-ai-surface-live-8.4.5)

The wave that (1) kills the Prompts/Evals 403, (2) makes the agent builder the ONE
canonical builder, and (3) collapses the AI surface to prefix-free `/v1/*`. Branched
off `main` (v8.4.4); commit only (CI builds the image).

- **ROOT CAUSE (verified vs cloud `clients/{prompts,agents,eval}.go` +
  `middleware_identity.go`).** Prompts + Evals made a cookie-only call to the cloud
  ORIGIN (`v1Url` → `cloud.hanzo.ai`). cloud's bearer surfaces resolve the org from a
  VALIDATED JWT owner claim (`SanitizeIdentity` → `tenant(c)`) and 403 a cookie-only
  request ("X-Org-Id required") — the live "Access required · GET /v1/prompts" card,
  same class as the "models missing" bug. cloud does NOT serve `/v1/get-account`
  (that's IAM/casibase, a DIFFERENT cookie), which is why get-account works cookie-only
  but `/v1/prompts` 403s. Agents already used the `/cloud` bearer proxy → "Connected".
- **ONE-ENDPOINT-FORM — same-origin `/v1/*`, NO prefix (CTO law).** New `originV1Url`
  (`client.ts`) builds `<origin>/v1/<path>`. `next.config.mjs` `rewrites().beforeFiles`
  maps a CLOSED head list to the console's already-hardened server-side bearer proxies:
  `prompts|agents|evals` → `/cloud`, `models|chat|embeddings|rerank|audio` → `/ai`. The
  client URL is `/v1/prompts`; the request terminates at OUR Next handler, which strips
  the cookie and mints a short-lived user bearer (`bearer-proxy.ts`). The raw session
  cookie NEVER reaches cloud-api → cloud-api carries no cookie-CSRF surface. This gives
  the clean URL WITHOUT weakening the bearer trust boundary. Repointed: `agents.ts`,
  `prompts.ts` (NEW facade), `evals.ts`, `models-catalog.ts`, `playground.ts`; `evals`
  added to `CLOUD_HEADS` (`proxy-allow.ts`). The rewrite CAN'T bypass least-privilege:
  it terminates at `/cloud`|`/ai` whose `pathIsClean` (rejects `..`/`%2e`/`%2f`/double-
  encode/matrix-param) + `allowCloudSurface`/`ALLOWED` re-validate the NORMALIZED path
  (13 existing bearer-proxy traversal tests + new proxy-allow evals tests).
- **CSRF HARDENING (proactive, `bearer-proxy.ts` `sameOriginOK`).** The proxy
  authenticates from the first-party session cookie (auto-sent cross-site), so a
  MUTATING request (POST/PUT/PATCH/DELETE) now requires the `Origin`/`Referer` host to
  equal `Host` — fail closed (403) BEFORE resolving the user. Stops a cross-site POST
  from creating/deleting an agent or running a paid eval as the victim; belt-and-
  suspenders on the cookie's own SameSite. Safe methods (GET/HEAD/OPTIONS) pass. This
  protects EVERY proxy (`/cloud`,`/ai`,`/vm`,`/paas`,`/tasksd`,`/billing`,`/commerce`),
  not just the AI surface (+7 tests).
- **CANONICAL AGENT BUILDER — ONE builder, zero duplication (CTO top principle).**
  `src/components/agent-builder/` is self-contained + schema-driven with NO host
  coupling (imports nothing from `~/lib/api`). It takes its data + effects as INJECTED
  loaders (`AgentBuilderLoaders`: `loadModels`/`loadPrompts`/`loadPromptBody`/`loadTools`/
  `createAgent`) over the ONE backend (`POST /v1/agents`). Lifts cleanly into
  `@hanzo/agent-builder`. `types.ts` (contract) + `logic.ts` (pure) + `AgentBuilder.tsx`
  (UI) + `index.ts`. DYNAMIC: Model = live `ComboBox` (type any id OR pick from the live
  `/v1/models` catalog); Prompt = selector of the org's saved prompts that fills the
  system prompt (Custom = free text — "selectable OR typed"); Tools = live `ComboBox` +
  chips. Every option set is REAL or the field degrades to typeable — never fabricated.
  New primitive `ui/ComboBox.tsx` + `combobox/filter.ts` (`filterOptions` is a LITERAL
  case-insensitive substring — never a compiled RegExp of user input; ReDoS-guarded).
  console2 wires it via `agents/loaders.ts`; `NewAgentForm` is a thin adapter.
- **Prompts UI:** `PromptsModule` uses the new DRY `PromptsApi` facade (mirrors
  `agents.ts`, defensive normalizers); list/detail/create/metrics over `/v1/prompts`.
- **Cloud-side direct-cookie path (FLAGGED, NOT done here):** `SanitizeIdentity`
  ALREADY validates a session-cookie JWT (`cookieTokenNames`). The "true" prefix-free
  direct path needs the console login to set the `iam_access_token` JWT cookie the
  sanitizer looks for — a CLOUD change on a separate branch. Making cloud accept the
  casibase session cookie directly would EXPAND cookie-CSRF to the cloud-api host, so
  it was deliberately NOT done; the clean `/v1/*` rewrite keeps the bearer BFF.
- **Unification map (research):** only `chat`/LibreChat has a real builder (Mongo
  `/api/agents`, model dropdown from `/api/models`); `app` (ai-supervisor=monitor,
  agents page=mock, Jan chat pkg=local), `hanzo.app` (dummy/marketing), `bot` (no code),
  `hanzobot/hub` (persona artifact registry — different concept), `team` (Huly fork).
  NONE call `/v1/agents` today. Migration = each surface supplies its own
  `AgentBuilderLoaders` for the ONE canonical `AgentBuilder` over `/v1/agents`.
- Verification: `tsc --noEmit` clean; `npm test` **773/773** (65 files; +7 filter,
  +14 builder-logic, +18 prompts normalizers, +4 origin-url, +6 loaders extractBody,
  +2 proxy-allow evals, +18 bearer-proxy CSRF/isolation/traversal; the stale
  `models-catalog` `/ai` assertion updated to the new same-origin contract);
  `next build` ✓ 14/14. Authenticated visual e2e is post-deploy.
- **RED review (fix-then-ship, 0 critical/high, 1 med, 2 low — all addressed):**
  - **MED-1 cross-tenant eval read.** RED found the isolation of `/v1/evals/scores`
    hung SOLELY on `/cloud` dropping the client `X-Project-Id`, with no test guarding
    it (the cloud `clients/eval` `tenant()` PREFERRED the client-controllable
    `X-Project-Id` over the bearer org for KMS key selection). Fixed at BOTH layers:
    (a) console2 — a dedicated regression suite pins `upstreamHeaders` DROPS a
    client-forged `X-Project-Id` without `forwardScope` (`bearer-proxy.test.ts`); (b)
    cloud — `eval.tenant()` now uses ONLY the sanitized `c.Org()`, never a raw header
    (branch `fix/eval-tenant-project-id-isolation`, `TestTenantIgnoresClientProjectID`).
  - **LOW-1 CSRF (already shipped, then hardened).** `sameOriginOK` now also honors
    `Sec-Fetch-Site` (browser-set, JS-unforgeable) — a `cross-site` mutating request is
    refused outright, on top of the Origin/Referer host==Host check.
  - **LOW-2 end-to-end traversal test.** Added `forwardWithUserBearer` tests with a
    mocked fetch proving a rewrite-fed traversal (`%2e%2e`, `../`, `%2f..%2f`, `..;`,
    direct `v1/iam`) returns 404 and NEVER fetches upstream, while a clean `v1/agents`
    forwards to the exact normalized path — closing RED's regression-net gap (the prior
    tests only exercised `pathIsClean` in isolation).
  - RED refuted (live-probed): rewrite→allow-list bypass, org-forgery, ComboBox ReDoS,
    prompt/spec injection, rewrite shadowing, honest-state.

## Product-release versioning — one umbrella, two build lineages

Hanzo Cloud ships as ONE product under a shared **"Hanzo Cloud &lt;MAJOR.MINOR&gt;"**
release label (**8.4** today), but the two artifacts keep their OWN correct build
versions — do NOT try to make them equal:

- **console** (this app) — npm/Next, versioned from `package.json` (8.4.x). CI tags
  the image `:v<package.json version>`. Its `major.minor` IS the umbrella release.
- **cloud** (`github.com/hanzoai/cloud`) — a **Go module**, versioned by git tag
  (v1.786.x). It MUST stay **v1.x.x** forever (the "never bump Go above v1" rule +
  Go module semantics: v8 would force the `/v8` module path). It ships under the
  same "Hanzo Cloud 8.4" umbrella, not on 8.x.

The umbrella label has **one source**: the console app version. `next.config.mjs`
injects `NEXT_PUBLIC_APP_VERSION` from `package.json`; `config.ts` derives
`branding.release` (major.minor) + `branding.productLine` ("Hanzo Cloud 8.4"),
shown on the sign-in screen. Never hardcode "8.4" a second time.

## Billing usage visibility per agent/product + admin business board (v8.4.14, feat/billing-usage-admin)

Two deliverables over the ONE `/v1` surface, all real data with honest empties, no
fabrication. The metering-attribution wave: Dave sees "which agent/product cost me
$X", and admin.hanzo.ai gets a SaaS business control board.

- **Agent + product cost dimension (usage/billing visibility).** The commerce usage
  ledger row (`UsageRecord`, `lib/api/aimetrics.ts`) now extracts `product` and
  `agent` from `metadata.{product,agent}` (canonical contract — cloud emits agent
  usage tagged with them; alt keys `surface`/`agentName`/`agentId` also read). Cost
  Reports (`billing/logic.ts` `SpendDimension`) gains `product` and `agent`
  breakdowns beside `model`/`provider`; `presentDimensions` OFFERS a dimension only
  when ≥1 ledger row carries it, so the product/agent toggles appear the moment cloud
  starts tagging spend and show nothing (never a fabricated column) until then.
  `BillingReports.tsx` renders the new dimensions (provider stays a model-only
  secondary column). Per-agent cost in the **Agents detail pane** (`agents/forms.tsx`
  `AgentDetailView`) now reads the SAME charged ledger — a new pure `agentUsageFor`
  (`aimetrics.ts`, grouped by `metadata.agent`, matched by agent id OR name) drives a
  "Cost · charged ledger" section (cost/requests/tokens), NOT a hardcoded/registry
  metric; honest "—" + note until spend is attributed. New DRY rollup `perAgent`
  mirrors `perModel`.
- **admin.hanzo.ai business board (global-admin only).** New living-overview config
  `admin-business` (`overview/living/registry.ts`) rendered by the ONE `LivingOverview`
  — MRR, revenue, usage cost, active orgs, customers; revenue/usage-cost trend;
  revenue-by-product, plan mix, and top-agents-by-cost donuts; business alerts; live
  platform activity; fleet health. Primary source `/v1/admin/overview` (all-orgs god
  view via `allOrgs:true`), honest fallback to the real usage ledger + operator
  health so the board is never blank; business-only tiles stay honest-empty on the
  fallback. `admin-overview.ts` gains an optional named-`distributions` map
  (revenue/plans/topAgents), only present when the backend sends it (empty payload
  maps identically → no phantom tile); `fromAdminOverview` projects each named
  distribution into `distribution[key]`. Registry catalog entry `business` (Observe,
  `admin: true`) — hidden from every customer's nav/launcher/palette; `getAdminGate`
  + `useIsGlobalAdmin` gate it and the aggregate is server-gated. Reuses the ONE
  overview system — adding it was a config + adapter projection, no new overview UI.
- **Mobile-responsive by construction.** All new/changed surfaces use @hanzo/gui v5
  shorthands + `flexWrap="wrap"` rows with `flex`/`minW` tiles (LivingOverview rows,
  BillingReports controls, Agent detail Fact rows) — the 5-KPI business row and the
  two-donut rows wrap to stack on narrow viewports; no fixed grids.
- **Unverified backend contracts (flagged, built honest to them):** `metadata.{product,
  agent}` on commerce ledger rows, and the `/v1/admin/overview` `distributions`
  (revenue/plans/topAgents) + `mrr`/`revenue`/`orgs`/`customers` KPI keys. Each
  degrades to an honest empty tile / hidden dimension until the field flows.
- Verification: `npm run typecheck` clean; `npm test` **841/841** (68 files; +7
  aimetrics product/agent extract + perAgent/agentUsageFor, +5 billing-logic
  product/agent groupSpend + presentDimensions gating, +4 admin-overview/adapters
  named distributions); `next build` ✓ Compiled successfully (lint+types clean).
  Authenticated visual e2e (business board as a global admin) is post-deploy.

### RED review fixes — god-view server gate + attribution + row cap (v8.4.15)

RED reviewed v8.4.14 (0 critical, 1 high, 1 med, 3 low, 1 info). All actionable
findings fixed; the fixes are defense-in-depth + correctness, no behavior regression.

- **H1 (HIGH → fixed): the admin business god-view had NO console-side server gate.**
  `AdminApi.overview`/`activity` hit `${config.cloudUrl}/v1/admin/*` — same-origin in
  prod, but `admin/*` was NOT in the `next.config.mjs` rewrite heads and there was no
  `app/admin/overview` route, so the all-orgs (`?org=all`) aggregate rested SOLELY on
  an unverified casibase backend gate (RED correctly caught that `getAdminGate` guards
  only `/admin/iam`, `/admin/kms`, `/paas` — not the overview path). Fix: NEW
  `app/admin/aggregate/[...path]/route.ts` runs `getAdminGate` (global-admin only,
  fail-closed 403) BEFORE forwarding through the shared `forwardWithUserBearer`
  (traversal + same-origin-CSRF hardening) to cloud-api. `next.config.mjs` rewrites
  `/v1/admin/{overview,usage,orgs,audit,products}` → `/admin/aggregate/*` (iam/kms
  deliberately NOT rewritten — they keep their own tenant-scoped proxies). New
  `originGet` (`client.ts`) pins the request to the console's OWN origin (not
  `config.cloudUrl`), so a split-origin `NEXT_PUBLIC_CLOUD_URL` can't bypass the gate;
  `AdminApi` uses it. Least-privilege surface is the pure, tested
  `lib/server/admin-aggregate.ts` `allowAdminSurface` (admits only the read heads,
  REFUSES `admin/iam`/`admin/kms`/bare `admin`). M1 (client-only render gate) is
  downstream of H1 and now backed by a real server gate.
- **L1 (LOW → fixed, proven): `agentUsageFor` id-OR-name collision.** The old
  `Set([id,name])` union conflated two distinct agents within an org when one's id
  equalled another's ledger tag, or two shared a name. Fix: try the id FIRST, fall
  back to the name only when the id matched nothing — never a union. Two RED-proven
  collision cases added to the tests.
- **L2 (LOW → fixed, proven): unbounded cost table.** A high-cardinality dimension
  (agent/product tags are set at inference time) could render thousands of rows. New
  pure `capRows` (`billing/logic.ts`, `COST_ROW_CAP=100`) bounds the DOM to the
  top-by-spend prefix with an honest "N more · Show all" affordance that reveals every
  real row on demand (a render bound, not a trust boundary — the rows are the caller's
  own paid spend). Tested.
- **I1 (INFO → accepted-as-is):** `AgentDetailView` fetches the org ledger per open.
  Within the existing `/billing` proxy policy (any session sees its OWN org billing —
  the same data the Cost Reports page shows), so not a new trust boundary; left as-is.
- **RED-refuted (verified safe, unchanged):** the fallback path (`UsageApi.overview
  ({allOrgs:true})` calls `fetchUsageRecords()` with NO args; the `/billing` proxy
  drops `?org` and pins the full billing-subject key set — no cross-tenant leak);
  metadata forgery is org-scoped display only; `normalizeDistributions` DoS; honest-
  state (no fabrication); client nav/launcher/palette gating of `business`.
- Verification: `npm run typecheck` clean; `npm test` **853/853** (69 files; +6
  admin-aggregate allow-list, +4 agentUsageFor L1 collision, +4 capRows L2);
  `next build` ✓ Compiled successfully — the new `/admin/aggregate/[...path]` route
  is registered. Live re-test (org=all → 403 as a customer / org-admin) is post-deploy.

## Billing tab URLs unshadowed — data proxy namespaced under /billing/v1/* (v8.4.16)

Live-verifying v8.4.15 surfaced a PRE-EXISTING routing collision that made every
billing tab except Overview unreachable in the deployed app: `app/billing/[...path]/
route.ts` (the per-tenant commerce DATA proxy) claimed the WHOLE `/billing/*` URL
space, and a Next route handler always wins over the catch-all page for a matching
segment. So `/billing/reports`, `/billing/budgets`, `/billing/invoices`, `/billing/
subscriptions`, `/billing/payment-methods`, `/billing/credits` — the tabbed
`BillingModule` sub-routes (`router.push('/billing/<tab>')`) — resolved to the proxy
and returned commerce's `{"error":"not found"}` (or, for `subscriptions`/`payment-
methods`/`invoices`, raw ledger JSON) instead of the UI. This blocked live
verification of the v8.4.15 Reports cost-dimension (product/agent) surface.

Fix (one-way, minimal): the DATA proxy is namespaced under **`/billing/v1/*`**
(matching the "always `/v1/`" convention), so it can never share path space with a
UI tab slug; the tab URLs fall through to the SPA (`app/(dashboard)/[...slug]`).
- Route handlers moved: `app/billing/[...path]` → `app/billing/v1/[...path]`,
  `app/billing/topup/wallet` → `app/billing/v1/topup/wallet`. The forward target is
  unchanged (`commerce/v1/billing/<path>` — the moved `v1` is a static URL segment,
  not part of the `[...path]` array).
- Client callers prepend `v1/`: `billingUrl()` in `lib/api/billing.ts` +
  `lib/api/aimetrics.ts` (both build `/billing/v1/<path>`), and `wallet.ts`
  (`appUrl('billing/v1/balance')`, `appUrl('billing/v1/topup/wallet')`).
- Tests updated to the new data path: `aimetrics.test.ts` (asserts
  `/billing/v1/usage`), `e2e/billing-isolation.spec.ts` (fetches `/billing/v1/<p>`).
  UI nav paths (`/billing/reports`, …) are unchanged — they now render the tab.
- Verification: `tsc --noEmit` clean; `npm test` **874/874** (70 files); `next build`
  ✓ — route table shows `/billing/v1/[...path]`, `/billing/v1/topup/wallet`, and the
  `/[...slug]` catch-all that now serves the billing tabs. Live confirm post-deploy.

## Business-OS suite — CRM + Content + ERP/Help Center + Accessibility, one consolidated PR (v8.4.17)

Consolidates three OVERLAPPING Business-OS PRs — #38 `feat/console2-crm` (the
original, superseded), #39 `crm-work` (CRM + Accessibility), #42
`blue/business-apps-console` (CRM + Content + ERP/Help Center) — into ONE canonical
superset. The three diverged on the shared CRM files (a "two ways to do one thing"
violation); this is the single mergeable reconciliation. Five `category: 'Apps'`
entries, all native modules over the ONE `/v1` surface (NO `/api/` prefix),
org-scoped SERVER-SIDE.

- **CRM** (`crm`, enabled) — companies/contacts/opportunities over the REAL cloud
  `/v1/crm` (native-Go `clients/crm` on Base/SQLite, a port of Twenty's core model).
  `lib/api/crm.ts` is same-origin, keyless, prefix-free (`originV1Url('crm/...')` →
  `<origin>/v1/crm`, NOTHING before `/v1/`) — the EXACT Agents/Prompts/Evals form;
  `next.config.mjs` `CLOUD_V1_HEADS` rewrites the `crm` head to the `/cloud`
  user-bearer proxy (org from the token owner claim; a cookie-only call 403s), `crm`
  allow-listed in `proxy-allow.ts` `CLOUD_HEADS`. `CrmModule` is one module, three
  collections via the `:tab` route — each a real list + inline create form + per-row
  delete, with `/v1/crm/summary` counts; honest loading / `BackendStateCard` /
  empty states, never placeholder rows. Defensive normalizers (unit-tested).
- **Content** (`cms`, enabled) — an honest in-console home for the live Content
  Studio (Payload headless CMS at `cms.<brand>`, white-label host derived from the
  console host); opens the Studio via IAM-SSO, NO fabricated content rows.
- **ERP** (`erp`) + **Help Center** (`helpdesk`) — real cloud primitives with no
  per-org console surface yet → HONEST `soon` (`routes: soonRoutes` → the shared
  `ComingSoon` waitlist), never a fake product.
- **Accessibility** (`accessibility`, enabled) — a Wix-style WCAG checker: Deque's
  axe-core (`import('axe-core')`, its own chunk, lazy) runs against the CURRENT page
  100% client-side (nothing leaves the tab; `resultTypes: ['violations']`). Pure
  sort/summarize/WCAG-label logic in `lib/a11y/scan.ts` (unit-tested, defensive);
  `AccessibilityModule` is only the panel (Scan button, per-severity cards, table).

Reconciliation decisions (DRY, one way):
- Kept **#39's `originV1Url` CRM data path** — it hits `/v1/crm` DIRECTLY (nothing
  before `/v1/`), the majority pattern across agents/prompts/evals/templates/
  analytics. #42's `cloudProxyV1Url` baked `/cloud` before `/v1/` — a divergent
  second way (that helper stays for `functions.ts`, its existing owner; not used
  for CRM). Both terminate at the same hardened `/cloud` bearer proxy.
- Kept **#39's `CrmModule`** — a strict superset of #42's (adds per-row delete +
  the `RowDelete` a11y-labelled control); everything else identical.
- Folded in **#42's `CmsModule`** + the `cms`/`erp`/`helpdesk` registry entries.
  Dropped #42's stray `gcp: 'Content'` on the cms entry (not a real GCP analog; the
  sibling Apps entries omit it).
- Regenerated `package-lock.json` for the new `axe-core` 4.12.1 dep (#39 had bumped
  `package.json` only — the lockfile was out of sync).
- #38/#39/#42 are superseded by this one PR (`feat/business-os-suite`).

- Verification: `tsc --noEmit` clean (0 errors); `npm test` **887/887** (72 files;
  +9 crm normalizer/route-contract + 4 a11y over main's 874); `next build` ✓
  Compiled successfully (14/14 pages, the `/[...slug]` catch-all renders every
  module). The crm route suite pins the same-origin `/v1/crm/{companies,summary,
  contacts,opportunities}` contract (never a `/cloud`-prefixed URL, never a direct
  cloud-origin call). Authenticated visual e2e (the `(dashboard)` modules) is gated
  behind an IAM session → post-deploy; component-mount + the live axe-core scan were
  Playwright-verified locally.

## Bounded upstream timeouts — no request-time server fetch can hang (v8.4.21)

Investigated the "brand host (cloud.lux.network) hangs during render while
console.hanzo.ai is fast" report. **It does NOT reproduce in the app** — and it
CANNOT, by design: the page render path (`app/layout.tsx` + `(dashboard)/layout.tsx`,
the only server components) does ZERO per-brand network fetch. There is no
`next/headers`, no `cookies()`, no `generateMetadata`, no `server-only` render
fetch. Brand is resolved from `window.location` in the browser; SSR uses the
build-time `NEXT_PUBLIC_DEFAULT_HOST`, so the SERVER HTML is byte-identical for
every brand host (verified: `curl -H 'Host: cloud.lux.network'` and
`-H 'Host: console.hanzo.ai'` return the SAME md5, `<title>Hanzo Cloud Console</title>`,
HTTP 200 in ~4-18ms for lux/zoo/pars/hanzo alike). The prod origin difference is
therefore an ingress/routing artifact, not app SSR (out of scope — app code only).

The one real "no timeout → the route wedges" hazard IS in code: every request-time
server `fetch()` (the `/v1/*` BFF proxies + IAM/cloud identity resolution) had NO
upstream timeout, so a reachable-but-silent backend would block that route until
the client gave up — the exact failure class described. Fixed DRY with ONE
`src/lib/server/fetch-timeout.ts` (`fetchWithTimeout`): a bounded `AbortSignal`
COMPOSED with any caller signal (`init.signal`, e.g. `req.signal`), so a request
aborts on EITHER a client disconnect OR the timeout. Default `10_000`ms, env
`HANZO_UPSTREAM_TIMEOUT_MS`. On timeout it rejects like an aborted `fetch`, so
every existing catch turns an infinite hang into the existing honest fallback
(`resolveUser` → null → 401; proxies → 502). Threaded through `identity.ts` (all
5 IAM/cloud calls), `bearer-proxy.ts` (the shared proxy engine → cloud/ai/vm/
tasksd/commerce/superbase), `iam-proxy.ts`, and the custom proxies (`/paas`,
`/training`, `/admin/kms`, `/billing`, `/billing/topup/wallet`, `/waitlist`). The
`/nodes` per-brand luxd RPC probe was ALREADY bounded (`NODES_RPC_TIMEOUT_MS`) and
is left as-is. New `fetch-timeout.test.ts` (6 tests): resolves-before-timeout,
aborts-on-timeout, aborts-on-caller-signal, already-aborted, timer-cleared, and
the non-positive opt-out. Verification: `npm run typecheck` 0 errors, `npm test`
**823/823** (69 files), `next build` green (all routes), and the Host-header curl
test returns 200 fast for BOTH cloud.lux.network and console.hanzo.ai.

## Content de-link-out + native ERP/Help — embedded Business-OS apps (v8.4.22)

CMS was a `window.open` link-out and ERP/Help were `soon` placeholders. This wave
ports all three into the console as EMBEDDED (SSO iframe) or HONEST-provision
surfaces — no `window.open` as the primary path, no fabricated app data — binding
to the canonical Payload/Frappe backends (never reimplementing them). CRM stays the
native-`/v1/crm` reference; these three are the *embed* half of the Business-OS.

- **Ground truth (verified live + against the cluster/repos), the design driver.**
  All three apps are today SINGLE shared per-BRAND instances (`HANZO_ORG=hanzo`),
  NOT per-customer-org: `cms.hanzo.ai` (one Payload, one SQLite/bucket, JWKS+proxy
  IAM — framable, no XFO/CSP), `help.hanzo.ai` (LIVE Frappe Helpdesk, real hanzo IAM
  OAuth2 `hanzo-helpdesk`, framable), `erp.hanzo.ai` (**502 — no backend at all**;
  single-site Docker-Compose ERPNext **v15**, `frame-ancestors 'self'`, no per-org
  host, no platform one-click endpoint). So per-org isolation is NOT implemented for
  customer orgs — embedding hanzo's CMS for maxpower would be cross-tenant. The
  modules encode exactly this reality; they never claim isolation that isn't there.
- **`EmbeddedApp` (`components/products/embed/EmbeddedApp.tsx`) — the ONE way to
  frame a canonical app IN the console shell.** Full-height iframe (viewport-minus-
  chrome) with a permissive-but-scoped `sandbox` (SSO/forms/popups; SOP still blocks
  the cross-origin console parent), a real loading state, "Reload", and an honest
  "Open full screen" fallback + printed origin (an iframe can't report a cross-origin
  load failure — so it NEVER fabricates a loaded/failed verdict it can't observe).
  CMS/ERP/Help all render through it. `ProvisionPanel` is the DRY honest pre-provision
  surface (what-it-is + features + a REAL `/waitlist` provisioning request, honest 501
  when the intake is closed — never a lying "deployed").
- **White-label host derivation** (`lib/products/embed-hosts.ts`, PURE + tested):
  `cms|erp|help.<brand-domain>` from the console host (drop the service label), so a
  Lux/Zoo console frames ITS OWN app, never Hanzo's. Tenancy is NOT in the host (per
  the reality above) — the ORG comes from the shared IAM session inside the embed.
- **`/embed-status` BFF (`app/embed-status/route.ts` + pure `lib/server/embed-probe.ts`).**
  A cross-origin browser can't read another origin's status (SOP+CORS), so this
  session-gated server route probes the brand app once and returns `{origin, embedUrl,
  reachable}` — the module decides embed-vs-provision. **NO god-mode** (unlike the
  admin-gated `/paas`, it holds no service token): the probe target is `<app>.<brand>`
  CLAMPED to the known brand domains, so a forged Host header can never turn it into
  an SSRF probe of an arbitrary host (unit-tested: `console.evil.com` → `cms.hanzo.ai`).
  The probe `fetch` is `AbortSignal.timeout(4500)`-bounded (the v8.4.21 no-hang rule).
- **Modules** (`Cms/Erp/HelpModule.tsx`): CMS embeds the Studio ONLY for a brand-org
  member / global admin (never frames the brand's content for a customer org — that's
  the cross-tenant guard); a customer org gets the honest "a Studio for your org isn't
  provisioned yet" panel. ERP is a `soon`→`enabled` native module: `erp.<brand>` is
  502 so it shows the honest "Deploy ERP" panel (real provisioning request), and the
  SAME reachability gate embeds the real desk the moment one is live (the ERP side must
  also allow the console origin in `frame-ancestors`; until then "Open full screen" is
  the honest fallback). Help embeds the LIVE shared brand support desk for every
  signed-in user (Frappe scopes tickets per-user via SSO — no per-org gate, no leak).
- Registry: `erp` + `helpdesk` flipped `soon`→`enabled` with real modules; `cms`
  entry unchanged (now renders the embed/provision module, not the link-out).
- Verification: `npm run typecheck` 0 errors, `npm test` **914/914** (76 files; +21:
  9 embed-hosts, 8 embed-probe incl. the SSRF clamp, 4 embed client normalizer),
  `next build` ✓ Compiled (`/embed-status` + the `/[...slug]` catch-all registered).
  Live visual e2e (Dave/maxpower → honest provision states; a brand-org identity →
  the real CMS/Help embed) is post-deploy.

## Real per-product Status/Logs/Metrics/Settings + Base content-type builder + live PaaS Applications (v8.4.23)

Three deliverables, one console image; all real per-org data or an honest state,
never a broken/blank/fabricated page. DRY: ONE shared per-product sub-page system,
ONE Base binding, ONE PaaS client — nothing bespoke-per-product, nothing
reimplemented.

- **Per-product Status · Logs · Metrics · Settings are REAL per product (the
  #1 fix).** The uniform base sub-pages were the console's weakest surface: a
  single-screen product's `/x/{status|logs|metrics|settings}` fell to
  `ProductSubpageStub` (a "not wired yet" placeholder — the "broken/generic" the
  user saw), and a tabbed product's `:tab` route SWALLOWED those slugs into its
  default tab. Fixed with ONE shared sub-page system driven by per-product
  metadata, plus a routing precedence change:
  - **Routing** (`match-core.resolveProductView`): a base slug the product does
    NOT own as a declared specific now resolves to `{ kind: 'subpage' }` — the
    shared per-product view — taking precedence over any generic `:tab` route.
    A product that OWNS a base slug (Embeddings › Settings, Prompts › Metrics)
    keeps its bespoke route; a declared-but-unwired non-base specific still stubs.
    `subpageIsWired` now returns true for every base slug (always real → never
    dimmed in the nav). `ProductView` gains the `subpage` kind; the catch-all
    renders `ProductSubpageModule` inside the error boundary.
  - **Per-product metadata** (`components/products/subpage/sources.ts`, pure +
    tested): `subpageSourcesFor(entry)` derives — reusing the native-overview
    health spec — the product's status service, logs service, metrics feed
    (`o11y` for AI/LLM products, else `usage`), and settings feed. No 105 bespoke
    maps: sensible defaults + tiny override sets.
  - **The ONE shared system** (`components/products/subpage/`): `ProductStatusView`
    (real per-service health from `PlatformApi.apps()` filtered to the product's
    service; admin → live verdict + workloads table, customer → honest "Connected ·
    managed by Hanzo", no service → honest managed card — never a fake green),
    `ProductLogsView` (real `/paas/logs?service=` filtered to the product; honest
    states), `ProductMetricsView` (AI/LLM → the real org o11y `MetricsModule`
    verbatim; else the commerce usage ledger filtered to the product tag, honest-
    empty), `ProductSettingsView` (real deployment facts — image/tag/cluster,
    read-only — + an org-Settings pointer; never a dead form), and the
    `ProductSubpageModule` dispatcher. Coverage map: `status`/`logs` are real for
    operator-managed products (admin) and honest-managed for customers/serviceless
    products; `metrics` is real o11y for {models, providers, inference, chat,
    agents, playground, embeddings, prompts, gateway, api} and per-product usage
    (honest-empty until tagged) for the rest; `settings` is honest-managed +
    real deployment facts everywhere (no product ships a fake editable form).
- **Base is a Supabase-style content-type dashboard (the #2 fix).** The `base`
  product (was the superbase *tenants* list) is now the per-org Base dashboard:
  list content types (collections) · **build a new content type** (name + typed
  fields incl. File/Media and Relation) · click a type to browse/edit its records.
  ONE Base binding — console2's OWN `/superbase` proxy (mints the user IAM bearer,
  stamps `X-Org-Id` from the JWT owner → persists to THIS org's Base). We do NOT
  reimplement Base; we drive its real `/v1/collections` API.
  - `base-data/api.ts` `BaseDataApi` gains `createCollection` (POST
    `/v1/collections`) + `deleteCollection`; the browse half (`CollectionTable`/
    `RecordDetailView`, shared with `Records`) is reused unchanged.
  - `proxy-allow.ts` `allowBaseSurface` widened to admit single content-type admin
    (`v1/collections/<name>`) + the scaffolds palette — still Base-superuser-gated
    + per-org (`X-Org-Id`); it STILL refuses Base's non-collection admin
    (settings/backups/logs), so `/superbase` stays a collections proxy, not a
    tunnel. (POST `/v1/collections` was already allowed by the existing
    `v1/collections` rule.)
  - `components/products/base/`: `logic.ts` (pure + tested — the 12-kind field
    palette incl. file/relation, validation, and the field→Base-payload mapping),
    `CollectionBuilder.tsx` (the table-editor form), `BaseDashboard.tsx` (index +
    builder + records routes). `BaseModule` is a thin adapter over it. Registry
    `base` routes → `'' · new · :collection · :collection/:id`.
- **Applications shows the org's REAL deployed apps on the LIVE PaaS.** The
  Compute → Applications page was a generic "managed by Hanzo" placeholder over the
  admin `/paas` inventory. It now drives the live per-org `/v1/platform/*` surface
  (projects → apps → deployments) through the `/cloud` bearer proxy (org resolved
  from the Bearer owner — a caller sees only their own apps). New `lib/api/paas.ts`
  `PaasApi` (projects/apps/deployments CRUD + `deploy` + `listAllApps` aggregate;
  plain-JSON transport like `functions.ts`), `platform` added to `CLOUD_HEADS`.
  New `components/products/paas/` `PaasApplications` (real app list with status +
  source + live URL, a **New app** deploy flow — project + git/image → build →
  live, and an app detail rail with deployment history + build status + redeploy)
  + pure `logic.ts` (tested). `ApplicationsModule` is a thin adapter. `StatusTag`
  learned the PaaS lifecycle words (live/building/deploying/succeeded/queued/…).
- Verification: `tsc --noEmit` clean; `npm test` **922/922** (76 files; +6
  subpage-sources, +18 base-builder logic, +12 paas logic, +2 proxy-allow base,
  +8 match-core subpage routing); `next build` ✓ (all routes). Live visual e2e as
  Dave (maxpower) is post-deploy.

## Embed entitlement gate — RED hardening of the CMS/ERP/Help embeds (v8.4.24)

RED reviewed v8.4.22's embeds (0 critical; SSRF clamp, iframe SOP, no-credential-
injection, honest normalizers all REFUTED) and flagged the console residuals: the
embeds *asserted* a server-side `org==tenant` guarantee the shared single-tenant
apps can't back, `/embed-status` handed the embed URL to any authenticated org, and
Help embedded the shared desk for everyone. Fixed:
- **Server-side entitlement gate.** `/embed-status` now resolves the caller's org
  (token owner) and returns `entitled` per app. cms/erp/help are ALL brand-owned
  single instances (`EMBED_OWNERSHIP` in `embed-probe.ts`), so a non-owning (customer)
  org gets `entitled:false`, **no embed URL**, and no probe — the module shows the
  provision panel. Only a brand-org member / global admin gets the embed. This is the
  AUTHORITATIVE gate (the old client `account.owner===iamOrgName` check was cosmetic);
  `brandOrgForHost` maps the SSRF-clamped brand domain → owning org. Client normalizer
  fails closed (`entitled` strict-true; a stale server → provision panel, never a frame).
- **Help is now brand-owned too** (was embed-for-all) — a customer never frames the
  shared Frappe Helpdesk (removes the unverified cross-org ticket-visibility risk);
  they get an honest "Help Center for your org" provision panel.
- **Dropped the false isolation claims** in `EmbeddedApp`/`embed-hosts`/module
  docstrings (the console gates WHO it frames; a shared app still owes its own per-org
  isolation — the root CMS per-org tenancy is a separate CMS-side fix).
- **Trimmed the iframe sandbox** (dropped `allow-top-navigation-by-user-activation`,
  `allow-popups-to-escape-sandbox`, `clipboard-read`).
- **`/waitlist` hardened**: the recorded email is bound to the session account (can't
  enroll `victim@othercorp`); stopped forwarding the forgeable `X-Forwarded-For`.
- Verification: `tsc` clean; `npm test` **+13** embed tests (entitlement + brand-org
  map + fail-closed normalizer); `next build` ✓ (`/embed-status` + `/[...slug]`).

## Honest-state punch-list — signed-in 403≠"sign in", read-402≠paywall, graceful re-auth, chunk self-heal (v8.4.25)

A patch above #49's v8.4.24 (whose CMS/ERP/Help entitlement gate is preserved
untouched). Closes the "renders real → every state honest" punch-list. All DRY —
one fix per shared primitive, no per-module snowflakes.

- **P1 — a SIGNED-IN 403 is NEVER "sign in" (3 broken pages + every 403 surface).**
  Finetuning (`/training`→`/v1/train/jobs`), Dashboards + Annotation Queues
  (`/v1/o11y/*`) told a logged-in user to "sign in" on a 403 — reads like a bug
  ("I AM signed in"). Root: the THREE shared error mappers conflated 401 and 403.
  Fixed in ONE place each: `BackendState.classifyBackend` (+`signin` kind),
  `observability/RuntimeNotice.classifyRuntime` (+`signin`), and
  `ui/States.honestError` (+`reauth`). Now **401 = session lapsed** → "Your session
  expired" + a graceful **Sign in again** action; **403 = signed-in-but-not-enabled**
  → honest "not enabled for your organization / admin-only surface" (o11y points to
  the real AI Metrics), never "sign in". Covers finetuning/dashboards/annotation-
  queues AND every other surface using these mappers (evals/datasets/prompts/
  settings/IAM/KMS/…).
- **P2 — a READ is never credit-gated (S3 402→"add credits").** Listing S3 buckets/
  objects that 402'd showed the "Add credits to continue" paywall on a READ. New DRY
  `BackendState.classifyRead` maps a 402-on-read → `null` → the caller's honest EMPTY
  state ("No buckets yet · Create one"), not a wall. `StorageModule` uses it for both
  the bucket list and the object list. (A paid WRITE still surfaces the billing
  message via the create toast — the paywall belongs on the write, not the read.)
- **P3 — graceful mid-task re-auth (session).** A mid-task expiry no longer dumps the
  user on `/`. New `auth/iam.ts` `stashReturnTo`/`takeReturnTo`/`startReauth`: `signIn`
  + `signInWith` (session.tsx) and every P1 `signin` card remember the current path
  (same-origin-only, auth-pages excluded) before redirecting to IAM; the `/auth/
  callback` lands the user **back where they were**. NOTE: token/session TTL itself is
  an IAM/cloud config concern (not console-side) — FLAGGED for the IAM lane; the
  console side (return-to + one-click re-auth) is done.
- **P4 — chunk-load self-heal hardened (the sweep's crash class).** A stale-deploy
  chunk error thrown during React RENDER hit the error boundary (a manual card), and
  the HTML-as-JS signature ("Unexpected token '<'" — a 404'd chunk served the SPA
  shell) wasn't even recognized as a chunk skew. Fixed: `boundary-logic.isChunkLoadError`
  now matches that signature (kept in sync with `ChunkGuard`), and the dashboard
  `error.tsx` AUTO-RELOADS once-per-window (shared guard key with `ProductErrorBoundary`
  — never double-reload) instead of stranding a card. So a redeploy self-heals at
  BOTH the product-boundary and segment-boundary levels + the window listeners.
- **Buttons:** self-audited — no dead/no-op `onPress`; the disabled CTAs
  (Containers/Kubernetes "Create …") are honest `HintButton`s with a reason, not dead
  buttons. The Base builder + Applications deploy buttons were verified working live
  in v8.4.23. (The separate interaction-sweep agent's specific button list wasn't
  accessible from here; its findings fold into a follow-up if any remain.)
- Verification: `tsc --noEmit` clean; `npm test` **953/953** (79 files; +6 boundary
  HTML-as-JS chunk cases); `next build` ✓. Live re-verify (the 3 pages honest, S3
  read empty-not-paywall, #49's entitlement gate still holds) is post-deploy.

## Record-form data-loss fix + Memory/Datasets delete + session-TTL flag (v8.4.27)

Interaction-sweep punch-list (43/45 buttons already worked). The one SERIOUS bug —
record forms with no inputs (silent data loss) — plus two delete affordances; the
"5-min logout" is diagnosed as a BACKEND concern (not a client change).

- **[BUG, data loss] Base/Records create+edit forms rendered ZERO inputs → blank
  rows.** `@hanzo/data`'s `RecordForm` renders a label then `FieldInput` per field,
  but `FieldInput` returns `null` when no Input is registered for the type (unlike
  the read router `FieldDisplay`, which has a fallback). The input registry is
  populated ONLY by an import SIDE EFFECT (`registerDefaults.ts` self-invokes), yet
  the package ships `"sideEffects": false` — so production webpack tree-shaking (we
  consume `@hanzo/data` via `transpilePackages`) PRUNES the registration. Registry
  empty → every field input is `null` → the form shows labels with NO inputs, a user
  can't type, and "Create" persists a BLANK record. (It worked in `next dev` — no
  tree-shaking — which is why only post-deploy broke; matches "Base proved editable
  locally".) **Fix (2 lines, DRY):** `Provider.tsx` imports and CALLS
  `registerDefaultFields()` at module scope — a USED binding webpack cannot drop, so
  the registry is populated app-wide (Base + Records + any future editable
  `@hanzo/data` surface). Idempotent, no window/DOM (SSR-safe). Root-fix flagged for
  the package: drop/scope its `sideEffects:false`.
- **[BUG] Memory Open/Delete broke on `/memory/undefined`.** `MemoryApi` returned
  raw rows with NO key normalization; the backend keys memories by `name` (like KMS
  secrets / Base collections), so a row often had no `id` → `/memory/<undefined>` →
  "this memory no longer exists", and delete/update mis-keyed. **Fix:** new
  `normalizeMemory` derives a stable `id` from the first present of
  `id/name/key/memoryId/memory_id/_id`, mapped in list/search/recall/remember/update
  so the whole module (open link, rowKey, edit, delete) works whatever the backend
  calls the key; `update`/`remove` send the key as BOTH `id` and `name` (robust
  whichever the backend reads). Memory already HAD delete buttons (list row + detail)
  — they now hit the right key. (+5 normalizer tests.)
- **[minor] Datasets — row-level delete.** `EvalsApi.deleteDataset` was present but
  unused; `DatasetsModule` now renders a per-row delete (confirm → real
  `DELETE /v1/evals/datasets/:name`, org-scoped, removes the dataset + its items →
  reload). One shared honest-delete pattern with Memory's name-keyed delete.
- **[the 5-min logout] Diagnosed as a BACKEND/IAM concern — flagged, not a client
  change.** The console session is an httpOnly cookie (`/v1/iam/signin`) + server-
  minted short-lived bearers (`issue-user-token`); the browser holds NO access/
  refresh token. So a client-side `grant_type=refresh_token` would REQUIRE putting a
  refresh token in the browser — an XSS-stealable SECURITY REGRESSION of the httpOnly
  model — and a keep-alive auto-reauth could redirect-loop on a hard session TTL. The
  real fix is the session/token TTL + slide-on-activity (IAM/cloud config — the
  coordinator's own iam#89 stages 1h-access), NOT console code. The correct console-
  side mitigation already SHIPPED in v8.4.25 (P3): graceful re-auth that returns the
  user to their exact task after re-signing in. Part of the observed "5-min logout"
  was also the test harness's concurrent shared-session sign-outs (a test artifact).
  Deliberately shipped no client token-handling.
- Verification: `tsc --noEmit` clean; `npm test` **970/970** (80 files; +5 memory
  normalizer); `next build` ✓ (15/15). Live re-verify (create a record with real
  values → persists non-blank; Memory Open+Delete; Datasets delete) post-deploy.

## Silent token-refresh — durable console OAuth session, no mid-task logout (v8.4.29)

Corrects v8.4.27's "5-min logout is a BACKEND concern, no client change" call. The
console had ZERO `grant_type=refresh_token` and pinned the AuthGate + every BFF proxy
to the cloud **casibase session cookie** (`cloud_session_id`) — a session it does not
own and cannot refresh, so it can lapse out from under a working tab and bounce the
user. IAM was already secure (7-day access + rotating/revocable 30-day refresh,
`grant_type=refresh_token` live). v8.4.27's "refresh needs a browser-held refresh
token (XSS)" was the wrong frame: the refresh is **server-side (BFF)**.

Ground truth (verified live against hanzo.id + cloud, in-cluster): `hanzo-console` is
a confidential client that supports `password` + `authorization_code` + `refresh_token`
with `offline_access` (returns a rotating refresh token); its access token is a hanzo.id
JWT `aud=hanzo-console` / `iss=https://hanzo.id`, which cloud's `SanitizeIdentity`
accepts (deployed `GATEWAY_ALLOWED_AUDIENCES` includes `hanzo-console`). The casibase
`cloud_session_id` is actually durable (1-yr GC, session-scoped cookie), and it is
LOAD-BEARING for the casibase admin surfaces (providers/models/stores/chat) + a couple
of session-only reads (get-account, get-cloud-usages) — so it is KEPT, not replaced.

The fix is **additive, one session manager, zero regression** (worst case === v8.4.28):
- **`src/lib/server/session.ts`** — THE token manager (server-only by construction:
  `node:crypto` + `next/server`). Sealed AES-256-GCM (key = HKDF(`IAM_MINT_CLIENT_SECRET`);
  no-secret → per-process random key, never a constant). Casdoor tokens are ~3.6 KB
  full-user JWTs (86 claims incl. password hash / TOTP secret) — the ACCESS token and
  the REFRESH token are BOTH that big — so a single cookie is impossible (browser ~4 KB
  per-cookie cap; a real browser silently REJECTS an oversized cookie — a bug curl never
  surfaces). Hence TWO httpOnly+Secure+Lax, 30-day cookies:
    - `hz_session` (Path=/, ~1 KB): the sealed IDENTITY — `{access-exp, PROJECTED
      claims}`. `sealSession` projects the access JWT to the small display/authz claim
      set (`accessClaims`) and discards the raw token (never stored/logged — no secret
      material). resolveUser + every BFF proxy + /auth/session GET read this; small, so
      it rides every request with no header bloat / gateway-431 risk.
    - `hz_rt` (Path=/auth, chunked `hz_rt0/hz_rt1`): the sealed REFRESH token, scoped to
      /auth so the big blob is sent ONLY to /auth/refresh|session (never /v1 or the BFF),
      and CHUNKED (`setCookies`/`readRefreshToken`) because sealed 3.6 KB > one cookie.
  `consoleSession(req)` reads the identity claims (AEAD-trusted — the seal IS the
  integrity anchor, no JWKS round-trip; only `exp` re-checked, 60s skew).
- **`app/auth/session/route.ts`** — POST establishes the console session for the
  signed-in user (server-side `passwordGrant`), **gated**: the caller must already be
  authenticated (a valid casibase session, `resolveUser`) AND the grant must resolve to
  the SAME principal (`sameSubject`) — so it can never run standalone with a stolen
  password and never bypasses MFA (MFA logins hand off to the hosted flow and never
  reach it). GET = the account from the console session (AuthGate reads this first).
  DELETE = sign out (revoke + clear).
- **`app/auth/refresh/route.ts`** — silent `grant_type=refresh_token`, rotation-aware
  (persists the NEW refresh token). NEVER clears the cookie on failure (multi-tab
  rotating-token race safety — a lost-race 401 must not nuke the winner's fresh cookie);
  only sign-out clears.
- **`resolveUser`** (identity.ts) prefers the console session (`consoleClaims`), falls
  back to the casibase get-account. So the AuthGate + `/cloud` bearer-proxy both read the
  ONE session manager (the coordinator's constraint), casibase as graceful fallback.
- **Client**: `lib/auth/refresh.ts` = single-flight `refreshSession()` (rotating tokens
  MUST NOT race). `session.tsx` arms a PROACTIVE timer at 80% of the access lifetime
  (only when < 2h — short tokens post the IAM 1h-access hardening; long tokens rely on
  reactive). `client.ts` `authedFetch` = REACTIVE (a 401 on any cloud/BFF call → refresh
  once → retry). `account.ts` `session()` self-heals on load (console GET → on miss,
  refresh once → retry → else casibase). `SignInForm` upgrades a password login to the
  console session (best-effort; a failure leaves the user on casibase — login never
  blocked). Social/MFA logins run on casibase (durable) unchanged.
- Unblocks the IAM 1h-access hardening (iam#89, universe#290): once the access token is
  1h, the proactive timer (48min) + reactive 401 keep the session warm — no bounce.
- Verification: `tsc --noEmit` clean; `npm test` **1001/1001** (83 files; +20 session
  seal/open/claims/grants/sealSession, +4 refresh single-flight, +5 resolveUser
  precedence); `next build` ✓ (`/auth/session` + `/auth/refresh` registered). Live-verified
  as z@hanzo.ai (curl + Playwright, prod): establish → 200 + `hz_session` (Path=/,
  ~1 KB, browser-safe) + chunked `hz_rt0/1` (Path=/auth) — all httpOnly; Secure; SameSite=Lax;
  Max-Age=2592000; GET /auth/session with `hz_session` ALONE → 200 (account hanzo/z, isAdmin)
  — self-sufficient; POST /auth/refresh → 200 + ROTATED refresh; replay of the OLD refresh
  token → 401 (one-time-use enforced). Browser: login stores the cookies, stays authenticated
  past 5 min (navigate + idle), no /signin bounce.
  `NEXT_PUBLIC_*` unchanged (no client-id switch); server-only env reused
  (`IAM_MINT_CLIENT_ID/SECRET`, `IAM_URL`) — no new secret to provision.

## Bots + Machines — two `kind` compute-analytics operator boards over the datastore (feat/console2-admin-fleets)

Two GLOBAL-ADMIN boards on admin.hanzo.ai (Observe, beside Business + Finance) —
**Bots** and **Machines** — two lenses over ONE datastore table, split on `kind`:
a **bot** is a machine running the @hanzo/bot agent (booted, gateway-connected); a
**machine** is raw compute visor opens. Each surfaces per-org/app/project count,
active, and spend, grouped org → app → project. Reads ONLY the datastore aggregate
(one cross-tenant GROUP BY, never a per-tenant SQLite fan-out — the
tenant-data-hierarchy invariant). Supersedes the initial single "Fleets" board (the
noun was wrong: bots and machines are distinct compute kinds, not one "fleet").

- **One admin aggregate head, zero new plumbing.** `compute` added to the existing
  global-admin-gated surface: `ADMIN_AGGREGATE_HEADS` (`lib/server/admin-aggregate.ts`)
  + `ADMIN_V1_HEADS` (`next.config.mjs`). The client calls same-origin
  `/v1/admin/compute?kind=bot|machine`; `next.config.mjs` rewrites it to
  `app/admin/aggregate/[...path]`, which runs `getAdminGate` (fail-closed 403,
  global-admin only) BEFORE forwarding a minted user bearer. Same RED-H1 gate as
  Business/Finance — no new proxy/trust boundary.
- **`lib/api/admin-compute.ts` — kind-parameterized client + pure tree.** OPTIONAL-SAFE
  over BOTH shapes: pre-aggregated `{ leaves }` (the cheap ClickHouse GROUP BY) OR raw
  `{ events }` (the coordinated 9-column datastore row: `org, app, project, kind, event,
  machine_id, size, price_cents, ts`), which pure `foldEvents` folds client-side.
  `normalizeCompute(raw, kind)` filters to the requested kind (defensive — the endpoint
  filters too); Rollup = `{ count, active, spendCents }` (count = distinct units of that
  kind, active = latest event non-terminal). Pure `buildTree` rolls up app + org, sorts
  by spend desc; snake_case + camel tolerated; garbage → empty tree, zero totals.
- **`ComputeModule.tsx` — ONE board, two exports.** `ComputeBoard({ kind })` renders
  totals KPIs (count/active/spend) + a collapsible org → app → project tree with
  per-leaf size chips + last activity; `BotsModule` / `MachinesModule` are thin
  `kind='bot'|'machine'` wrappers (Bots and Machines are the same board). Honest states:
  loading, operator-access-required (403), not-routed (404), error, empty. Both catalog
  entries `admin: true` (hidden from every customer). Registry ids `bots` + `vms`
  (the admin machines lens; the per-org customer `machines` entry — visor
  `/vm/v1/machines` — is a different, non-admin surface, so its id is kept and the admin
  one imports `MachinesModule as AdminMachinesModule`).
- **Backend SHIPPED (paired PR).** cloud-api `GET /v1/admin/compute`
  (`clients/admin/compute.go`, `app.Get(..., s.guard(s.compute))`) aggregates
  `hanzo.compute_events(org, app, project, kind, event, machine_id, size, price_cents,
  ts)` grouped by `(org, app, project, kind)` over the shared `aiobject.DatastoreQuery`
  (the `clients/analytics` transport; stays **v1.x.x**). `?kind`/`?org` filter,
  `?range=24h|7d|30d` bounds; two-level roll-up (inner `argMax(event,ts)` per machine →
  outer count/active/sum). Honest-empty when the warehouse/table isn't wired yet (the
  visor/commerce emitter is still pending) — the board renders the honest empty state
  until events flow. (hanzoai/cloud PR #62.)
- Verification: `tsc --noEmit` clean; `npm test` **1012/1012** (84 files; +12
  admin-compute fold/tree/normalize/kind-filter, +1 admin-aggregate compute head);
  `next build` ✓. cloud: `gofmt` clean, `go build ./...` green, `go test ./clients/admin`
  ok. Authenticated visual e2e (both boards as a global admin) is post-deploy; renders
  the honest empty state today (no emitter). Not merged to main / no version bump — the
  merge/release step bumps `package.json` + tags the image.

## Native ERP / CMS / Analytics + real Commerce + resilient fetch (v8.4.33)

(v8.4.32 built the native-apps set below off b647d98; v8.4.33 is the deployed superset —
same native apps PLUS the shared-fetch transient-retry, one build.)

- **Resilient shared fetch — backend rolls are INVISIBLE to customers.** Root cause of a
  real "Could not load — Upstream service is unavailable" (Dave/maxpower on the Models
  catalog): cloud is single-replica `Recreate`, so a deploy-roll has a brief downtime
  window; a read that lands in it got a 502/503/504 and the console dumped the user on a
  scary manual-Retry card. Fixed in the ONE shared fetch (`client.ts` `authedFetch` →
  the pure, injectable `resilientFetch`) that BOTH the casibase-envelope (`request`) and
  plain-REST (`restRequest`) paths flow through — so it covers EVERY client fetch (Models,
  Overview, Billing, CRM, CMS, ERP, commerce, analytics, agents, prompts, …). A TRANSIENT
  upstream error (502/503/504 or a network connection error) on an IDEMPOTENT read
  (GET/HEAD) auto-retries with a short exponential backoff (`RETRY_BACKOFF_MS`
  300→900→2000ms, up to 3 retries) BEFORE surfacing the honest "Could not load" card — so
  a momentary roll self-heals and the card shows ONLY on a persistent outage. A genuine
  4xx (401/403/404/402) is NOT retried (honest state immediately, per the existing
  mapping); a MUTATION (POST/PUT/PATCH/DELETE) is NOT auto-retried (a 5xx'd write may have
  applied — re-sending could double-create; the user retries manually); a caller-aborted
  request is honored, never retried. The 401 silent-refresh (v8.4.29) is preserved as the
  second orthogonal resilience, guarded against a refresh loop. +13 tests
  (`client-retry.test.ts`): the exact Models-catalog 503→200 self-heal, budget-exhaust →
  honest error, network-retry, 4xx/mutation no-retry, abort honored, 401 refresh no-loop.

## Native ERP / CMS / Analytics + real Commerce over canonical backends (v8.4.32 → shipped in v8.4.33)

Maximize NATIVE app coverage in the console — get ERP, Content (CMS), Analytics, and
Commerce to the same "native-in-console, per-org, one canonical way" bar CRM already
meets. Every surface binds to its REAL backend (contracts verified against the source
repos + live probes); no surface fabricates data. Per-app isolation matches each
backend's real tenancy model (RED-checkable).

- **Analytics — rebound to the FOUR routes the backend actually mounts.** The module
  had called NINE `/v1/analytics/*` endpoints; `cloud clients/analytics` mounts only
  `overview | timeseries | top | health` (analytics.go:95-98) with DIFFERENT response
  shapes — so 5 tabs 404'd and 2 mis-parsed. `analytics.ts` + `AnalyticsModule.tsx`
  rewritten to the real structs (`clients/analytics/query.go`): the **LLM lens is REAL
  live per-org data** (`hanzo.cloud_usage`, prod ClickHouse `datastore.hanzo.svc:9000`),
  charted over time; the **web + commerce lenses render honest-empty via the backend
  `available` flag** (`hanzo.events`, until a collector emits) — never fabricated zeros.
  Dropped the fabricated **Real-Time tab** (no realtime backend exists). Tabs: Overview
  (LLM KPIs + spend-over-time + honest web/commerce lenses) + LLM (top models table +
  donut). Range grammar `24h|7d|30d`. Responses are BARE JSON (not the casibase
  envelope) → plain `restGet`.
- **Content (CMS) — native Collections + Media/DAM ALONGSIDE the Studio embed.** New
  `/cms` user-bearer proxy (`app/cms/[...path]`) forwards the caller's minted IAM Bearer
  to `cms.<brand>` (SSRF-clamped via `clampedBrandDomain`); Payload's `hanzoIAMStrategy`
  verifies it (JWKS, issuer hanzo.id, audience unchecked) and its multi-tenant plugin
  scopes `pages`/`media` to the token `owner` claim → **each org reads ONLY its own
  content (per-org isolation BACKEND-enforced)**. `allowCmsSurface` admits ONLY the two
  tenant-scoped collections (list) + the per-file media bytes route, and REFUSES
  `api/users`/`api/tenants` (the non-tenant-scoped registry). `CmsModule` is now tabbed:
  **Collections** (native pages) + **Media** (native DAM grid; `<img>` bytes stream
  through `/cms/api/media/file/<f>`, never the cross-origin auth-required `media.url`) +
  **Studio** (the entitlement-gated admin embed, unchanged). `cms.ts` `CmsApi`.
- **ERP — real deploy + native Frappe summaries + desk embed, entitlement-gated.** ERP
  is a SINGLE shared per-brand Frappe instance (`erp.<brand>` is 502 today, no per-org
  provisioning), so the module + the new `/erp` proxy are **entitlement-gated to the
  owning brand org / a global admin** (a customer org gets the honest provision panel —
  never the brand's ERP data; Frappe is single-tenant). Overview drives a **REAL
  `/v1/platform` deploy** (`ErpApi.deploy` → idempotent create-project + create-app
  {source:image, `frappe/erpnext:v15.62.0`} + deploy, live status from `PaasApi`).
  Accounting / Items / Sales are **NATIVE Frappe REST summary views** (`/erp/api/
  resource/<DocType>`, real erpnext-v15 field sets) — honest "deploy ERP" until an
  instance answers, real rows the moment it does. `/erp` proxy: SSRF-clamped, read-only
  `api/resource/<DocType>` allow-list (`allowErpSurface`), Frappe `token key:secret`
  auth via server-only `ERP_API_TOKEN` (Frappe rejects an IAM Bearer). Desk embeds the
  real desk once reachable. `erp.ts` `ErpApi`.
- **Commerce — Products full CRUD + real store settings.** Products is now create +
  list + **delete** over `/v1/product` (validator needs name+sku+slug — auto-slugified);
  Store settings reads the org's REAL storefront (`/v1/store/current`,
  `CommerceApi.currentStore`). Orders/Customers/Inventory/Promotions stay real per-org
  reads on the shared `CommerceResource`. All via the `/commerce` bearer proxy (org from
  the token owner; per-org SQLite). Kind-names verified live (product/order/user=
  customers/variant=inventory/discount=promotions/store — `customer`/`inventory`/
  `checkout` are 404, the console correctly avoids them). hanzoai/commerce is the ONE
  authority (Go, per-org SQLite) — NOT Medusa.
- **GPUs KPI reconciled** (drive-by): the customer GPU KPI counted distinct MODELS (6)
  but the catalog table + Launch drawer list all CONFIGS (9). KPI now shows the
  launchable-config count (matches both) with the model count in the sub — both real
  from the one live visor catalog.
- **Isolation model (RED):** CMS is genuinely per-org (Payload isolates by owner claim →
  every org reads its own, no entitlement gate needed, registry collections refused);
  ERP + Help are single-tenant Frappe → brand-org/global-admin entitlement gate (a
  customer never reads brand data); Commerce is per-org (commerce EdgeAuth owner scope).
- Verification: `tsc --noEmit` clean; `vitest` **1050/1050** (88 files; +22 new:
  7 analytics, 6 cms, 5 erp normalizers, +2 cms/+2 erp proxy-allow); `next build` ✓
  (`/cms` + `/erp` routes registered). Built off origin/main HEAD (rebased onto the
  ServiceMesh/Edge lane), one patch above main → **v8.4.32**. Live visual e2e +
  per-org RED isolation checks are post-deploy.

## P0 fetch-binding fix + live-shape corrections + Playground multi-image/image-only (v8.4.34)

v8.4.33 shipped a REGRESSION my mocked tests hid; live verification (RENDERING the app,
not just probing APIs) caught it. This patch fixes it, corrects two live-shape bugs the
same live pass surfaced, folds in RED's LOW-1, and lands the two Playground fixes.

- **[P0 — CRITICAL, the whole API layer] "Illegal invocation" on every fetch.** The
  v8.4.33 `resilientFetch` refactor called `deps.doFetch(url,init)` — a METHOD call → the
  browser global `fetch` ran with `this=deps` and threw *"Failed to execute 'fetch' on
  'Window': Illegal invocation"* on EVERY cloud/BFF call (Analytics/Models/CRM/CMS/… all
  "Could not reach the backend"). The `client-retry` unit tests passed because they injected
  a MOCK `doFetch` (a plain fn with no `this` requirement) — the exact class of bug a mock
  hides. Fix (`client.ts`): destructure `const doFetch = deps.doFetch` + call it BARE
  (`doFetch(url,init)`, this=undefined) — works for a raw global `fetch` AND a wrapped one.
  **New regression test** simulates a global-only fetch (throws unless `this` is the global)
  and asserts resilientFetch invokes it bare — would have RED-failed the v8.4.33 wiring.
  Rolled the live console back to v8.4.31 the moment it was caught (function restored in ~1
  min), fixed forward here. LESSON: a shared-fetch refactor MUST be verified by RENDERING a
  data page live, not only by unit tests with a mocked fetch.
- **[live-shape] CMS numeric ids + prefixed media url.** Live prod pages/media use Payload's
  SQLite INTEGER ids (`{"id":3}`) — `normalizePage/Media` read them as strings so ids became
  `''` (rowKey collisions). Fixed with a number-aware `idStr`. And the media bytes url carries
  a `?prefix=<tenant>` query my filename-reconstruction dropped → new `cmsMediaSrc` proxies the
  doc's REAL `url` (path+query) through `/cms` (never the cross-origin host). +5 cms tests.
- **[live-shape] Commerce store settings.** `/v1/store/current` wraps the record as
  `{ store: {...} }` (verified live) — `currentStore` now unwraps `.store` before normalizing
  (a bare object still works), so the Store-settings page shows the real name/currency.
- **[RED LOW-1] `/erp` allow-list pinned to the 3 UI DocTypes.** Was any `api/resource/
  <DocType>`; now EXACTLY `{Account, Item, "Sales Order"}` (`ERP_DOCTYPES`), so an entitled
  brand member can't `GET /api/resource/User`/`Salary Slip`/`OAuth Bearer Token` through the
  shared `ERP_API_TOKEN` (a brand-internal over-read once ERP ships). RED verdict on v8.4.33:
  **0 critical/high/med, 1 low (this), 2 info; cross-tenant isolation SOUND across CMS/ERP/
  Help/Analytics — SHIP.** (INFO-1 host-from-config + INFO-2 audience-scoped bearer are
  deploy-config follow-ups, non-leaking.)
- **[Playground] Multi-image upload.** The composer held a SINGLE `attachment`; now
  `attachments: Attachment[]` (`useComposer`) with `addAttachments` (APPEND — a multi-select
  dialog OR successive uploads/drag-drops accumulate, never replace) + per-image
  `removeAttachment`. `Composer.tsx`: the file input is `multiple`, `onFile` reads EVERY
  selected image to a data URL in parallel, drag-drop of several is wired, and a thumbnail
  strip shows each image with a count + an individual remove (×). `compose.ts` `imageUrl` →
  `imageUrls[]`; `buildRunMessages` pushes ONE `image_url` part per image on the last user
  turn (OpenAI multimodal allows several).
- **[Playground] "Run does nothing" (image-only) + visible block reasons.** `validateRun`
  now counts an attached image as user content — an IMAGE-ONLY vision prompt is valid (content
  = just the image parts) and Run proceeds; it blocks ONLY a genuinely-empty message (no text
  AND no image) with a clear "Enter a message or attach an image to run." And that reason now
  renders PROMINENTLY (a red bordered notice with an icon) right above the Run button inside
  the Composer — hitting Run is never a silent no-op. (`VisionPlayground` — a separate
  URL-input surface — is untouched.) +10 compose tests (multi-image, image-only, blank-image
  filter, the new validation messages).
- Verification: `tsc --noEmit` clean; `vitest` **1076/1076** (89 files); `next build` ✓.
  Built off origin/main (my v8.4.33 work + the machines lane #57 already in main; one patch
  above → **v8.4.34**, tagged for a cancel-immune build). LIVE re-verify (a data page RENDERS
  real data — not just an API 200 — + attach 2-3 images → multi-image vision run + image-only
  Run works + block reason visible) is the required post-deploy gate this time.

## Inference endpoints dashboard + Status/Logs + shared per-product Metrics (v8.4.37)

The Inference page is redesigned to the "endpoints dashboard" mockup — wired to REAL
data everywhere, honest "—"/empty where a metric isn't exposed, NEVER the mockup's
placeholder figures (32.4K / 128ms / 99.95% / $1,286.42 / zen-3-32b rows are DESIGN
PLACEHOLDERS and appear nowhere). Sidebar + topbar untouched; only the Inference module
content + the SHARED sub-page Metrics view changed. Strictly @hanzo/gui v5 shorthands.

- **Real endpoints source (two, merged).** `src/lib/api/inference.ts` `InferenceApi`
  reads the org's DEPLOYED KServe InferenceServices from cloud `GET /v1/ml/models`
  (cloud `clients/ml`, per-org namespace `ml-<org>`) through the hardened `/cloud`
  user-bearer proxy — NEW `ml` head in `proxy-allow.ts` `CLOUD_HEADS` + `next.config.mjs`
  `CLOUD_V1_HEADS` (same-origin `/v1/ml/*` → `/cloud/v1/ml/*`, bearer minted, cookie-only
  403s). These are folded (`mergeEndpoints`, deployed wins) with the MANAGED model-serving
  catalog (`/v1/models` via the `/ai` proxy). The managed catalog is the POPULATED base
  (per-endpoint metrics match the ledger by model id); the deployed source is best-effort
  (403/404 when ML isn't routed just omits those rows). Honest empty ("No endpoints yet ·
  Deploy your first endpoint") when both are empty.
- **Per-endpoint metrics — REAL or honest "—".** Requests (24h) + trend sparkline = the REAL
  commerce usage ledger (`aimetrics` `perModelMap`/`endpointDailyRequests`) matched by model
  id (no rows → real 0; ledger absent → "—"). P95/uptime have NO per-endpoint source →
  honest "—". KServe status → honest phase via `deriveMlPhase` (reads `status.conditions`).
- **Layout.** Header + PURPLE "Deploy Endpoint" CTA → a REAL `POST /v1/ml/models` deploy form
  over the shared `DetailPane`. Hero "Connected to Hanzo Cloud" (honest managed copy + pure-SVG
  purple accent, white-labeled by `config.brandName`). Two-column: LEFT `EndpointsPanel`
  (search + status/type/sort over REAL options + list⇄grid + rich rows + pagination; row →
  detail pane); RIGHT rail (stacks on narrow) = Usage Overview (REAL `usageWindow` ledger totals
  + prior-period deltas + sparklines) + Quick Actions + Need help (REAL routes + mailto — no
  dead links).
- **Status + Logs = Inference-OWNED `:tab` views** (declared SPECIFIC subpages → router renders
  THESE not the shared sub-page; Metrics + Settings stay shared). Status = per-endpoint health
  board + "Connected to <brand>" real tally (uptime/P95 "—"). Logs = REAL recorded inference
  activity (ledger = one row per billed call: time · endpoint · level · message), filter by
  endpoint + level; honest "not connected"/"no activity" — never fabricated log lines.
- **Shared per-product Metrics → rich LivingOverview (DRY, EVERY product benefits).**
  `ProductMetricsView` renders the ONE `LivingOverview` over `productMetricsConfig` (4 KPIs
  Requests/Tokens/Spend/P95 with deltas+sparklines, usage+spend over time, 3 breakdown donuts
  top-models-by-tokens/requests-by-status/spend-by-model, recent-usage feed) — REAL commerce
  ledger scoped by `metadata.product`. inference/models/api/gateway read the WHOLE ledger (it
  IS entirely inference calls); every other product filters by tag (honest-empty until
  attributed). P95 honest "—" until o11y. Added `byStatus` + `product` filter to the usage
  adapter; projected `byModelTokens`+`byStatus` in `fromCloudUsage` (additive).
- Verification: `tsc --noEmit` clean; `vitest` **1130/1130** (94 files; +28: 20 inference logic,
  3 product-metrics, +byStatus/product-filter usage-adapter, +byModelTokens/byStatus adapters,
  +ml proxy-allow); `next build` ✓ (the `/[...slug]` catch-all renders Inference + `:tab`).
  Rebased on origin/main (v8.4.36, the nav-accordion + gpus lanes) → one patch above → **v8.4.37**.
  Live visual verification is the post-deploy gate.

## Base = the Bases manager (multi-base) + no competitor copy (v8.4.42)

Two Base fixes: the user was "stuck with a single base" and the copy named a
competitor. ROOT CAUSE (live-verified as maxpower): the `base` product was a
"Supabase-style content-type dashboard" pointed at `/superbase/v1/collections` —
which is the SuperBase ORCHESTRATOR's OWN Base (base.hanzo.ai). So the "content
types" it listed were the orchestrator's control-plane collections
(`contacts`/`tenants`/`users`, with `_orgs`/`_superusers` filtered out) — one
shared Base, no way to make another. The REAL Bases registry is the `tenants`
collection (each row = a Base instance on its own `<slug>.base.hanzo.ai`; live it
holds e.g. "Acme CRM Test", slug `acme-crm-test`, spec `{replicas:3,storage:10Gi}`).

- **Base is now the Bases INSTANCE manager (the multi-base fix).** `BasesManager`
  (`components/products/base/BasesManager.tsx`) over the real tenants API: `''` =
  the org's Bases list + **New Base**, `new` = create (name → auto-slug + a size
  preset → `POST /v1/collections/tenants/records`), `:base` = configure one
  (edit name/size, live provisioning status, open its subdomain, delete). ONE Base
  binding — console2's `/superbase` proxy (mints the user IAM bearer, stamps
  `X-Org-Id` from the JWT owner — derive-once). `lib/base-data/tenants.ts`
  (`BaseTenantsApi` + `normalizeBase`, reuses the one `BaseDataApi` record client)
  + pure `base/bases-logic.ts` (slugify, validateBase, `SIZE_PRESETS`, `statusOf`,
  `baseHref`). Honest states everywhere (loading / `BackendStateCard` / empty
  "Create your first Base" / superuser+402 create gates → clear message). Registry
  routes `''|new|:base`; the shared subpage slugs (status/logs/metrics/settings)
  still take precedence over `:base` (match-core), so the sub-nav is unchanged.
- **Clean split from Records.** Base = manage Base INSTANCES; the sibling `Records`
  product browses a Base's DATA (collections + records) — the two no longer overlap.
  The superseded content-type dashboard (`BaseDashboard`/`CollectionBuilder`/
  `base/logic.ts` + tests) is removed (it was the confusing orchestrator-collections
  surface).
- **No competitor copy.** Dropped every "Supabase"/"Supabase-style"/"Firebase-like"
  string from the Base UI + docstrings and rewrote in Hanzo's own voice
  (`BaseModule` docstring, the registry `base` description, the new manager copy).
  Also removed `gcp: 'Firebase'` from the Base entry (it rendered "Equivalent to
  Firebase" on the Base surfaces). FLAGGED, not changed: the systematic `gcp:`
  field is a 29-entry cross-console GCP-equivalence feature (Vertex AI / Cloud Run /
  Cloud Storage / Firestore / "Firebase Hosting" on `apps` / …) used as a
  migration + search aid — stripping it globally is a separate product-wide call.
- **Backend flags (per-org isolation is a superbase concern, not console).** The
  `tenants` ListRule is `owner_iam_user = @request.auth.id` (per-user, not
  org-scoped) and the console's minted token appears over-privileged on
  base.hanzo.ai (a signed-in probe saw a foreign tenant + `_superusers`/`_orgs`).
  So true per-org isolation of the Bases list needs a backend fix (org-scoped
  ListRule + a non-superuser service identity + owner stamping). Separately,
  per-tenant DATA routing isn't wired (`/superbase` reaches the orchestrator, not
  `<slug>.base.hanzo.ai`), so a Base's own collections are managed in Records / its
  own dashboard once provisioned — the manager never fabricates per-tenant data.
- Verification: `tsc --noEmit` clean; `vitest` **1134/1134** (94 files; +14 bases-logic
  incl. normalizeBase, +1 proxy-allow tenants-by-id, −the deleted content-type logic
  tests); `next build` ✓. Live: the tenants API path is proven reachable (returned the
  real "Acme CRM Test" Base); the authenticated UI create+screenshot is the post-deploy
  gate. Rebased on origin/main (v8.4.41) → **v8.4.42**.

## Built-in assistant is a grounded Hanzo-suite expert across every chat surface (v8.4.43)

The console's built-in chat was a generic model chat — only ⌘K had a system prompt,
and that was a NAV-only mapping, not a knowledgeable assistant. This wave makes the
assistant a genuine expert on the WHOLE Hanzo suite, GROUNDED in real sources (the
product registry + docs RAG), never hallucinated — one shared prompt across all three
chat surfaces. Touches ONLY the assistant/chat surfaces (no registry/agents/overview
edits).

- **ONE grounded system prompt, DECOMPLECTED (`src/lib/assistant/`).** Split into a
  PURE builder (`prompt-content.ts` — no registry/React/config imports, unit-tested in
  isolation per the repo convention that `registry.tsx` is types-only in vitest because
  of its icon ESM) and a THIN registry-bound wrapper (`system-prompt.ts`). The prompt
  has three parts: (1) a curated, accurate **"what Hanzo is" overview** (Hanzo Cloud =
  build/ship AI software; the real product families — Zen models, Compute/GPUs,
  Data = Base+Vector+KV+SQL+…, Security = IAM+KMS, Dev, Platform/PaaS, Observe, Web3,
  Apps incl CRM/CMS/ERP/Chat, Commerce; the app surfaces beyond the console — hanzo.app
  web builder, Chat, Desktop, Extension; pay-as-you-go per-token pricing + real balances;
  how to navigate/deep-link) — written to what EXISTS, nothing invented; (2) the FULL
  product catalog **generated FROM the live registry** via `visibleCatalogByCategory`
  (the SAME gate the nav uses) — every product's label, one-line description, GCP analog,
  and in-console deep-link (`/id`), grouped by category with the registry's own
  `CATEGORY_SUMMARY` headers — so it is complete, stays current on its own, is
  white-labeled per brand (`config.brandName`), and **omits admin-only surfaces for a
  customer** (never suggests a locked page); (3) a behavior contract: concise, accurate,
  deep-link real pages, defer to the live catalog for models/prices, and — critically —
  answer HONESTLY ("Hanzo doesn't have a video editor") rather than invent a product,
  feature, endpoint, price, or model. No secrets in the prompt (public catalog + product
  facts only).
- **Wired into ALL 3 chat surfaces (DRY, one source).** `ChatConversation` (which backs
  BOTH the floating bubble `FloatingChat` and the full `/chat` page) builds the prompt
  admin-scoped (`useIsGlobalAdmin`) and sends via `AiApi.ragChat` — so every turn is the
  expert prompt + docs retrieval. `CommandPalette` `>` "Ask AI" now uses
  `commandBarSystemPrompt` (the SAME expert prompt + the `NAV <id>` contract appended, so
  ⌘K both jumps to a product on a clear intent AND answers knowledgeably otherwise —
  replacing the old nav-only prompt); the `?` docs mode is grounded with the same expert
  system prompt too. The catalog is derived ONCE (the command-bar variant is just base +
  nav directive). Suggested-prompt chips reseeded to the assistant's real domain
  ("How do I launch a GPU?", "What is Hanzo Base?", "How does pricing work?", "What AI
  models are available?").
- **Docs RAG grounding (best-effort, honest).** The chat requests `X-Retrieval` +
  `X-Retrieval-Store: docs` (`ASSISTANT_DOCS_STORE`, ONE store name shared with the ⌘K
  `?` mode). Server-side (`ai/controllers/chat_retrieval.go`) retrieval is relevance-based
  top-4 semantic search scoped to the caller's org and **degrades to a plain answer on any
  failure / empty store** — so the assistant is fully versed from the registry-derived
  prompt whether or not a docs store is indexed for the org. `AiApi.ragChat` extended with
  optional `history` (2-line, backward-compatible — the assistant's own binding) so the
  grounded chat keeps multi-turn context. Whether the `docs` store returns real
  docs.hanzo.ai content is a per-org indexing question verified post-deploy; if empty it's
  a RAG follow-up, not a regression.
- Verification: `tsc --noEmit` clean; `npm test` **1142/1142** (95 files; +10
  prompt-content builder tests: overview facts + brand white-label + entry/opensAt
  formatting + catalog generation + honest-boundary + NAV-superset + no-secrets);
  `next build` ✓ Compiled successfully. Rebased on origin/main (v8.4.42, the Bases-manager
  lane) → one patch above → **v8.4.43**. Idiom: @hanzo/gui v5 shorthands; sidebar/header
  untouched. Live Q&A verification (bubble + full chat + ⌘K, incl. an honest "no such
  feature" answer) is the post-deploy gate.

## Shared per-product Status/Logs/Metrics/Settings — correct, per-product, DRY (v8.4.45)

The uniform base sub-pages (Overview · Status · Logs · Metrics · Settings) are made
REAL, correct, and per-product across EVERY product, driven by ONE metadata-driven
system — no bespoke-per-product pages, no fabrication. Only the shared subpage system
(`components/products/subpage/*`), the native-overview specs (`overview/*`), and the
living-overview metrics config (`overview/living/*`) + per-product metadata are touched.

- **Metrics scoped PER PRODUCT + one metadata source (DRY).** The Metrics dashboard
  already filtered the usage ledger by `metadata.product === <id>` (`usage-adapter.
  buildCloudUsageOverview`), but the "which products are the inference surface" decision
  was DUPLICATED — a DEAD `MetricsFeed`/`O11Y_METRICS_PRODUCTS` set in `subpage/sources.ts`
  (ignored by the view) AND the live `RAW_INFERENCE_PRODUCTS` in `product-metrics.ts`.
  Consolidated to ONE place: `sources.ts` `metricsScopeFor(id)` →
  `{ product, scope }` — `INFERENCE_SURFACE_PRODUCTS = {inference,models,api,gateway}`
  read the WHOLE inference ledger (`product:null`, `scope:'inference-all'`), every OTHER
  product filters by its own tag (`product:id`, `scope:'product'`, honest-empty until
  attributed — NEVER the org total). `product-metrics.ts` + `ProductMetricsView` consume
  it. **Audit-proofing:** the 4 inference-surface products (whose ledger genuinely IS the
  whole inference ledger — every call flows through them) now carry an explicit honest
  banner ("This is your org's whole inference ledger — every model call flows through
  <label>. Higher-level products show only their own attributed usage.") + a scope-aware
  subtitle, so the whole-ledger view is TRUTHFULLY LABELED, never masquerading as a narrow
  per-product slice or an org-aggregate leak.
- **Status/Logs service accuracy (grounded in the live `/v1/apps`).** Probed the real
  operator inventory (108 apps): the derived service name (`repoBase(repo) ?? id`) was
  WRONG for a few products, so Status/Logs showed a false "not deployed" for services that
  ARE running. Added a verified `SERVICE_OVERRIDE` in `sources.ts` — `models` (repo
  `hanzoai/ai` derived `ai`; the real operator app is `models`), `bot`→`bot-gateway`,
  `helpdesk`→`help` — each maps to a service that genuinely appears in `/v1/apps`, so
  Status lights up REAL health. Fixed the stale `console` spec health service
  (`console2`→`console`, the canonical operator app). gateway/dns/kms/metrics/s3 are
  raw-deployed (NOT operator apps) → they correctly show an honest "not reporting", and the
  Status/Overview "no service" copy was made neutral+honest ("operator inventory reports no
  running <label>… may be a shared managed service reported elsewhere… no status is
  fabricated") instead of a misleading "Provision it". Platform `/v1/logs` rejects even the
  service token, so Logs resolves to a Logs-specific honest "managed by Hanzo" card (never
  fabricated lines).
- **Settings is product-specific + REAL (not a dead generic form).** `settingsConfigFor
  (entry)` (`sources.ts`) surfaces each product's real configuration — REUSING the product's
  native-overview spec facts+actions verbatim where one exists (DRY, one content source:
  gateway/api/cli/… Base URL/Auth/endpoint + Create-API-key), else a category-appropriate
  honest config (AI → `api.hanzo.ai/v1` + Bearer + Manage-API-keys; data resources →
  connection pointer + the product's own page; Security → managed; default → the product's
  own page). `ProductSettingsView` renders a NEW **Configuration** card (real facts +
  real in-console links) above About/Deployment/Org — every value real or an honest "—".
- **Overview customized for ALL.** The 12 native-overview products all carry rich bespoke
  `OVERVIEW_SPECS` (verified by `resolve.test`); `defaultSpec` stays honest (real
  category/repo facts, NO fabricated actions/health). The `console` spec health repointed to
  the real app. Products with their own overview module (Inference/Models/Functions/GPUs/
  Vector/…) are untouched (other lanes) — their Status/Logs/Metrics/Settings ARE this shared
  system.
- DRY + honest by construction; strictly @hanzo/gui v5 shorthands, mobile-responsive
  (flexWrap rows). Did NOT touch `AgentsModule`/`agents/*` or `assistant/*`.
- Verification: `tsc --noEmit` clean; `vitest` **1140/1140** (94 files; +10: metricsScopeFor
  scope/consolidation, SERVICE_OVERRIDE, settingsConfigFor reuse+category defaults, honest
  inference-surface framing); `next build` ✓ (all routes). Rebased on origin/main (v8.4.44)
  → **v8.4.45**. Live authenticated spot-check (Models/Inference/Functions/GPUs/Vector/
  Gateway/IAM/Commerce) is the post-deploy gate.

## Base copy follow-up — last competitor name out of the assistant prompt (v8.4.46)

A whole-repo sweep after v8.4.42 caught the ONE remaining user-facing competitor
reference to Base: the built-in AI assistant's system prompt (`src/lib/assistant/
prompt-content.ts`) described Base as "a **Firebase-style** backend" (introduced by
the v8.4.43 grounded-assistant lane). Rewritten in Hanzo's own voice — "a realtime
backend — spin up per-org Bases with content types, records, and auth" — so the
assistant never names a competitor when describing Base. The console is now fully
free of Supabase/Firebase user-facing copy (the systematic `gcp:` GCP-equivalence
field remains, flagged separately as a cross-console migration/discovery feature).

- Drive-by (restores main to green): `overview/living/open-edition.test.ts` (the #60
  Open Edition lane) used the OLD vitest `vi.fn<[Args], Return>()` two-type-arg form,
  which the pinned vitest v3.2.4 rejects — main's `tsc --noEmit` was RED. Migrated to
  the v3 single-function-type form `vi.fn<(p?: UsageOverviewParams) => Promise<…>>()`.
- Verification: `tsc --noEmit` clean; `vitest` **1163/1163** (96 files); `next build` ✓.
  Rebased on origin/main (v8.4.45) → **v8.4.46**.
